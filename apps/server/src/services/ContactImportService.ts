import { defaultContactStage } from './PipelineService'
// "Import as contacts" (doc/10 §7A step 5, doc/09 §9.1): the explicit canonical
// import. An ordinary spreadsheet import (DocumentService.importCsv) only makes a
// native grid and never touches contacts; this service is the one path from a
// table — pasted CSV or an already-imported sheet — to Contact records.
//
// preview → (review ambiguous rows) → commit. Proposals come from the one matcher
// (contactMatch.ts): email is a signal, not identity (D2). Commit never overwrites
// an existing contact; it runs in resumable chunks under a workspace lock, so a
// retry continues where it stopped and concurrent imports can't race each other
// into duplicates. Raw row values are PII and are pruned after the retention
// window (D12); outcomes and provenance (Contact.importBatchId) stay.
import { createHash } from 'crypto'
import { db, Prisma, type ImportBatch, type ImportProposal, type ImportResolution, type ImportRow } from '@project/db'
import type { GridTable } from '@project/shared'
import { badRequest, conflict, httpError, notFound } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { toContactRef } from '../lib/serialize'
import { runAction } from './actions'
import { isRoleAddress, matchContactsByEmail, normalizeEmail, normalizePoint } from './contactMatch'
import { displayNameOf, preparePoints, writePoints, type PointInput } from './ContactService'
import { DocumentService } from './DocumentService'
import { parseDocumentCsv } from './documentCsv'
import { assertAssignees, assertTags, replaceTags } from './records'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize } from './workspacePolicy'
import { lockImport, lockPreview } from './importState'

type Tx = Prisma.TransactionClient
const documents = new DocumentService()

export const IMPORT_FIELDS = ['firstName', 'lastName', 'displayName', 'title', 'email', 'phone', 'accountName', 'externalId'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]
type Mapping = Record<string, ImportField>
type Options = { ownerMemberId?: string | null; tagIds?: string[]; externalProvider?: string | null }
type Values = Partial<Record<ImportField, string>>
type Source = { kind: 'csv'; csv: string; filename: string } | { kind: 'document'; documentId: string }
type Counts = { create: number; match: number; review: number; duplicate: number; invalid: number; unresolved: number; created: number; matched: number; skipped: number }

const CHUNK = 100
const DEFAULT_VIEW_COLUMNS = ['displayName', 'primaryEmail', 'primaryPhone', 'title', 'createdAt'] as const
export const retentionDays = () => Math.max(0, Number(process.env.IMPORT_ROW_RETENTION_DAYS ?? 30))
const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue

// Header → field guesses; the person confirms or corrects them before commit.
const SUGGEST: [RegExp, ImportField][] = [
  [/^(first ?name|given ?name|first)$/, 'firstName'],
  [/^(last ?name|surname|family ?name|last)$/, 'lastName'],
  [/^(name|full ?name|contact ?name|display ?name|contact)$/, 'displayName'],
  [/^(title|job ?title|position|role)$/, 'title'],
  [/^(e-?mail|e-?mail ?address|work ?e-?mail|email1)$/, 'email'],
  [/^(phone|phone ?number|mobile|mobile ?phone|telephone|tel|cell|work ?phone)$/, 'phone'],
  [/^(company|company ?name|organi[sz]ation|account|account ?name|employer)$/, 'accountName'],
]

export function suggestMapping(columns: { id: string; label: string }[]): Mapping {
  const mapping: Mapping = {}
  const used = new Set<ImportField>()
  for (const c of columns) {
    const label = c.label.trim().toLowerCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ')
    const field = SUGGEST.find(([rx, f]) => rx.test(label) && !used.has(f))?.[1]
    if (field) {
      mapping[c.id] = field
      used.add(field)
    }
  }
  return mapping
}

function validateMapping(mapping: Mapping, columns: { id: string }[], options: Options): Mapping {
  const ids = new Set(columns.map((c) => c.id))
  const seen = new Set<ImportField>()
  for (const [columnId, field] of Object.entries(mapping)) {
    if (!ids.has(columnId)) throw badRequest(`Unknown column "${columnId}"`, 'INVALID_MAPPING')
    if (!IMPORT_FIELDS.includes(field)) throw badRequest(`Unknown contact field "${field}"`, 'INVALID_MAPPING')
    if (seen.has(field)) throw badRequest(`"${field}" is mapped twice`, 'INVALID_MAPPING')
    seen.add(field)
  }
  if (seen.has('externalId') && !options.externalProvider?.trim()) throw badRequest('Mapping an external id needs options.externalProvider', 'INVALID_MAPPING')
  if (![...seen].some((f) => ['firstName', 'lastName', 'displayName', 'email', 'phone'].includes(f))) {
    throw badRequest('Map at least one of name, email or phone', 'INVALID_MAPPING')
  }
  return mapping
}

const hashTable = (table: GridTable) => createHash('sha256').update(JSON.stringify([table.columns.map((c) => c.label), table.rows.map((r) => table.columns.map((c) => r.cells[c.id] ?? ''))])).digest('hex')

type Planned = Omit<Prisma.ImportRowCreateManyInput, 'batchId' | 'workspaceId'>

/** One proposal per row, with batched lookups (one query per signal, not per row). */
async function plan(workspaceId: string, table: GridTable, mapping: Mapping, options: Options): Promise<Planned[]> {
  const fieldColumn = Object.fromEntries(Object.entries(mapping).map(([col, field]) => [field, col])) as Partial<Record<ImportField, string>>
  const valuesOf = (cells: Record<string, string | null>): Values =>
    Object.fromEntries(IMPORT_FIELDS.flatMap((f) => {
      const v = fieldColumn[f] ? cells[fieldColumn[f]!]?.trim() : undefined
      return v ? [[f, v]] : []
    }))
  const rows = table.rows.map((r, i) => ({ rowNumber: i + 1, sourceRowId: r.id, raw: r.cells, values: valuesOf(r.cells) }))

  const validEmail = (v: Values) => {
    if (!v.email) return null
    try {
      return normalizePoint('email', v.email)
    } catch {
      return undefined // invalid
    }
  }
  const emails = [...new Set(rows.flatMap((r) => { const e = validEmail(r.values); return e ? [e] : [] }))]
  const points = emails.length
    ? await db.contactPoint.findMany({ where: { workspaceId, kind: 'email', normalized: { in: emails }, live: true }, select: { normalized: true, contactId: true, shared: true } })
    : []
  const holders = new Map<string, { personal: Set<string>; all: Set<string> }>()
  for (const p of points) {
    const h = holders.get(p.normalized) ?? { personal: new Set(), all: new Set() }
    h.all.add(p.contactId)
    if (!p.shared) h.personal.add(p.contactId)
    holders.set(p.normalized, h)
  }
  const provider = options.externalProvider?.trim() || null
  const externalIds = provider ? [...new Set(rows.flatMap((r) => (r.values.externalId ? [r.values.externalId] : [])))] : []
  const byExternal = new Map(
    (externalIds.length
      ? await db.contact.findMany({ where: { workspaceId, deletedAt: null, externalProvider: provider, externalId: { in: externalIds } }, select: { id: true, externalId: true } })
      : []
    ).map((c) => [c.externalId!, c.id]),
  )

  const seen = new Map<string, { rowNumber: number; identity: string }>()
  const identityOf = (values: Values) => [
    values.displayName || [values.firstName, values.lastName].filter(Boolean).join(' '),
    values.phone, values.accountName,
  ].map(value => value?.trim().toLowerCase() ?? '').join('|')
  return rows.map((r) => {
    const base = { rowNumber: r.rowNumber, sourceRowId: r.sourceRowId, raw: json(r.raw), values: json(r.values) }
    const email = validEmail(r.values)
    if (email === undefined) return { ...base, proposal: 'invalid' as const, errorCode: 'INVALID_EMAIL' }
    if (!(r.values.displayName || r.values.firstName || r.values.lastName || email || r.values.phone)) return { ...base, proposal: 'invalid' as const, errorCode: 'EMPTY_CONTACT' }
    const key = r.values.externalId && provider ? `ext:${r.values.externalId}` : email ? `email:${email}` : null
    const previous = key ? seen.get(key) : undefined
    if (previous) {
      if (key!.startsWith('ext:') || (!isRoleAddress(email!) && previous.identity === identityOf(r.values))) {
        return { ...base, proposal: 'duplicate' as const, duplicateOfRow: previous.rowNumber }
      }
      return { ...base, proposal: 'review' as const, errorCode: 'SHARED_FILE_EMAIL', candidateIds: json([...(holders.get(email!)?.all ?? [])]) }
    }
    if (key) seen.set(key, { rowNumber: r.rowNumber, identity: identityOf(r.values) })
    const external = r.values.externalId && provider ? byExternal.get(r.values.externalId) : undefined
    if (external) return { ...base, proposal: 'match' as const, proposedContactId: external, candidateIds: json([external]) }
    const h = email ? holders.get(email) : undefined
    if (!h) return { ...base, proposal: 'create' as const }
    if (h.personal.size === 1) {
      const [only] = h.personal
      return { ...base, proposal: 'match' as const, proposedContactId: only!, candidateIds: json([...h.all]) }
    }
    // Several personal holders, or only a shared/role address: a person decides.
    return { ...base, proposal: 'review' as const, errorCode: h.personal.size > 1 ? 'AMBIGUOUS_EMAIL' : 'SHARED_ADDRESS', candidateIds: json([...h.all]) }
  })
}

function countsOf(rows: Pick<ImportRow, 'proposal' | 'resolution' | 'outcome'>[]): Counts {
  const c: Counts = { create: 0, match: 0, review: 0, duplicate: 0, invalid: 0, unresolved: 0, created: 0, matched: 0, skipped: 0 }
  for (const r of rows) {
    c[r.proposal]++
    if (r.proposal === 'review' && !r.resolution) c.unresolved++
    if (r.outcome) c[r.outcome]++
  }
  return c
}

async function recount(client: Tx | typeof db, batchId: string) {
  const rows = await client.importRow.findMany({ where: { batchId }, select: { proposal: true, resolution: true, outcome: true } })
  return client.importBatch.update({ where: { id: batchId }, data: { counts: json(countsOf(rows)), totalRows: rows.length } })
}

/** Drops raw values of finished imports past the retention window; cancels stale previews. */
export async function pruneImports(now = new Date(), workspaceId?: string) {
  const cutoff = new Date(now.getTime() - retentionDays() * 24 * 60 * 60 * 1000)
  const scope = workspaceId ? { workspaceId } : {}
  await db.importBatch.updateMany({ where: { ...scope, status: 'previewed', updatedAt: { lt: cutoff } }, data: { status: 'cancelled', finishedAt: now } })
  const due = await db.importBatch.findMany({ where: { ...scope, rowsPrunedAt: null, finishedAt: { lte: cutoff } }, select: { id: true } })
  if (!due.length) return 0
  const ids = due.map((b) => b.id)
  await db.importRow.updateMany({ where: { batchId: { in: ids } }, data: { raw: Prisma.DbNull, values: Prisma.DbNull } })
  await db.importBatch.updateMany({ where: { id: { in: ids } }, data: { rowsPrunedAt: now } })
  return ids.length
}

async function previousImportId(batch: ImportBatch) {
  const prior = await db.importBatch.findFirst({
    where: { workspaceId: batch.workspaceId, kind: batch.kind, sourceHash: batch.sourceHash, status: 'completed', id: { not: batch.id }, createdAt: { lt: batch.createdAt } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  return prior?.id ?? null
}

async function toImport(batch: ImportBatch) {
  return {
    id: batch.id,
    workspaceId: batch.workspaceId,
    kind: batch.kind,
    status: batch.status,
    source: { kind: batch.sourceDocumentId || !batch.filename ? ('document' as const) : ('csv' as const), documentId: batch.sourceDocumentId, filename: batch.filename },
    columns: batch.columns as { id: string; label: string }[],
    mapping: batch.mapping as Mapping,
    options: batch.options as Options,
    totalRows: batch.totalRows,
    counts: batch.counts as Counts,
    // The same file was already imported: shown before commit so it isn't applied twice by accident.
    previousImportId: await previousImportId(batch),
    resultDocumentId: batch.resultDocumentId,
    createdById: batch.createdById,
    createdAt: batch.createdAt,
    committedAt: batch.committedAt,
    finishedAt: batch.finishedAt,
    rowsPrunedAt: batch.rowsPrunedAt,
  }
}

async function loadBatch(workspaceId: string, importId: string) {
  const batch = await db.importBatch.findFirst({ where: { id: importId, workspaceId, kind: 'contacts' } })
  if (!batch) throw notFound('Import not found')
  return batch
}

// A contact that was merged since the preview resolves to its survivor.
async function liveTarget(tx: Tx, workspaceId: string, contactId: string | null) {
  let contact = contactId ? await tx.contact.findFirst({ where: { id: contactId, workspaceId } }) : null
  for (let hops = 0; contact?.deletedAt && contact.mergedIntoId && hops < 10; hops++) {
    contact = await tx.contact.findFirst({ where: { id: contact.mergedIntoId, workspaceId } })
  }
  return contact && !contact.deletedAt ? contact : null
}

export class ContactImportService {
  async list(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'record.read')
    const batches = await db.importBatch.findMany({
      where: { workspaceId, kind: 'contacts' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    })
    return Promise.all(batches.map(toImport))
  }

  async get(userId: string, workspaceId: string, importId: string) {
    await authorize(userId, workspaceId, 'record.read')
    return toImport(await loadBatch(workspaceId, importId))
  }

  async create(ctx: WorkspaceCtx, workspaceId: string, input: { source: Source; mapping?: Mapping; options?: Options }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.import')
    await pruneImports(new Date(), workspaceId)
    const options: Options = { ownerMemberId: input.options?.ownerMemberId ?? null, tagIds: input.options?.tagIds ?? [], externalProvider: input.options?.externalProvider?.trim() || null }
    await assertAssignees(workspaceId, options)
    await assertTags(workspaceId, options.tagIds)

    let table: GridTable
    let filename: string | null = null
    let sourceDocumentId: string | null = null
    if (input.source.kind === 'csv') {
      table = parseDocumentCsv(input.source.csv)
      filename = input.source.filename.trim() || 'import.csv'
    } else {
      // An imported (ordinary) sheet the caller can read; the sheet itself is untouched.
      const { row } = await documents.access(ctx.user.id, workspaceId, input.source.documentId)
      if (!row.payload) throw badRequest('Only a spreadsheet with imported rows can be imported as contacts', 'NOT_A_SHEET')
      table = row.payload as unknown as GridTable
      sourceDocumentId = row.id
    }
    if (!table.rows.length) throw badRequest('The table has no data rows', 'EMPTY_IMPORT')
    const columns = table.columns.map((c) => ({ id: c.id, label: c.label }))
    const mapping = validateMapping(input.mapping ?? suggestMapping(columns), columns, options)
    const planned = await plan(workspaceId, table, mapping, options)
    const sourceHash = hashTable(table)

    const batch = await runAction(
      {
        action: 'contact.import.preview',
        workspaceId,
        actor: memberActor(actor),
        origin: ctx.origin,
        // No row values in the audit log: they are PII and are pruned from the import itself.
        input: { source: input.source.kind, filename, sourceDocumentId, sourceHash, mapping, options, rows: planned.length },
        target: { type: 'import' },
      },
      async (tx) => {
        const created = await tx.importBatch.create({
          data: { workspaceId, kind: 'contacts', sourceDocumentId, filename, sourceHash, columns: json(columns), mapping: json(mapping), options: json(options), counts: json({}), createdById: actor.member.id },
        })
        await tx.importRow.createMany({ data: planned.map((r) => ({ ...r, batchId: created.id, workspaceId })) })
        return { value: await recount(tx, created.id), targetId: created.id }
      },
    )
    return toImport(batch)
  }

  // Changing the mapping or options re-runs the preview (resolutions start over).
  async update(ctx: WorkspaceCtx, workspaceId: string, importId: string, input: { mapping?: Mapping; options?: Options }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.import')
    const batch = await loadBatch(workspaceId, importId)
    if (batch.status !== 'previewed') throw conflict('Only a previewed import can change', 'IMPORT_NOT_PREVIEWED')
    if (batch.rowsPrunedAt) throw conflict('This import’s rows were pruned', 'IMPORT_PRUNED')
    const options: Options = { ...(batch.options as Options), ...input.options }
    await assertAssignees(workspaceId, options)
    await assertTags(workspaceId, options.tagIds)
    const columns = batch.columns as { id: string; label: string }[]
    const mapping = validateMapping(input.mapping ?? (batch.mapping as Mapping), columns, options)
    const stored = await db.importRow.findMany({ where: { batchId: importId }, orderBy: { rowNumber: 'asc' }, select: { sourceRowId: true, raw: true } })
    const table: GridTable = { columns: columns.map((c) => ({ ...c, type: 'text' })), rows: stored.map((r, i) => ({ id: r.sourceRowId ?? `r${i + 1}`, cells: r.raw as Record<string, string | null> })) }
    const planned = await plan(workspaceId, table, mapping, options)

    const updated = await runAction(
      { action: 'contact.import.remap', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { mapping, options }, target: { type: 'import', id: importId } },
      async (tx) => {
        await lockPreview(tx, workspaceId, importId, 'contacts', batch.updatedAt)
        await tx.importRow.deleteMany({ where: { batchId: importId } })
        await tx.importRow.createMany({ data: planned.map((r) => ({ ...r, batchId: importId, workspaceId })) })
        await tx.importBatch.update({ where: { id: importId }, data: { mapping: json(mapping), options: json(options) } })
        return { value: await recount(tx, importId), changes: { mapping: [batch.mapping, mapping] } }
      },
    )
    return toImport(updated)
  }

  async rows(userId: string, workspaceId: string, importId: string, opts: { proposal?: ImportProposal; outcome?: 'created' | 'matched' | 'skipped'; cursor?: string; limit?: number }) {
    await authorize(userId, workspaceId, 'record.read')
    await loadBatch(workspaceId, importId)
    const limit = normalizeLimit(opts.limit)
    const cursor = decodeKeyCursor<{ n: number }>(opts.cursor)
    if (cursor && !Number.isInteger(cursor.n)) throw badRequest('Invalid cursor')
    const rows = await db.importRow.findMany({
      where: { batchId: importId, ...(opts.proposal ? { proposal: opts.proposal } : {}), ...(opts.outcome ? { outcome: opts.outcome } : {}), ...(cursor ? { rowNumber: { gt: cursor.n } } : {}) },
      orderBy: { rowNumber: 'asc' },
      take: limit + 1,
    })
    const result = page(rows, limit, (last) => encodeKeyCursor({ n: last.rowNumber }))
    const ids = [...new Set(result.data.flatMap((r) => [...((r.candidateIds as string[] | null) ?? []), ...(r.contactId ? [r.contactId] : [])]))]
    const refs = new Map((ids.length ? await db.contact.findMany({ where: { id: { in: ids }, workspaceId } }) : []).map((c) => [c.id, toContactRef(c)]))
    return {
      data: result.data.map((r) => ({
        id: r.id,
        rowNumber: r.rowNumber,
        sourceRowId: r.sourceRowId,
        values: (r.values as Values | null) ?? null,
        proposal: r.proposal,
        errorCode: r.errorCode,
        candidates: ((r.candidateIds as string[] | null) ?? []).flatMap((id) => (refs.has(id) ? [refs.get(id)!] : [])),
        proposedContactId: r.proposedContactId,
        duplicateOfRow: r.duplicateOfRow,
        resolution: r.resolution,
        resolvedContactId: r.resolvedContactId,
        outcome: r.outcome,
        outcomeNote: r.outcomeNote,
        contact: r.contactId && refs.has(r.contactId) ? refs.get(r.contactId)! : null,
      })),
      meta: result.meta,
    }
  }

  // A person's decision for one row: create a new contact, use an existing one, or skip it.
  async resolve(ctx: WorkspaceCtx, workspaceId: string, importId: string, rowId: string, input: { action: ImportResolution; contactId?: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.import')
    const batch = await loadBatch(workspaceId, importId)
    if (batch.status !== 'previewed') throw conflict('Only a previewed import can change', 'IMPORT_NOT_PREVIEWED')
    const row = await db.importRow.findFirst({ where: { id: rowId, batchId: importId } })
    if (!row) throw notFound('Row not found')
    if (row.proposal === 'duplicate') throw badRequest('A repeated row follows the row it repeats', 'DUPLICATE_ROW')
    if (row.proposal === 'invalid' && input.action !== 'skip') throw badRequest('An invalid row can only be skipped', 'INVALID_ROW')
    if (input.action === 'use') {
      if (!input.contactId) throw badRequest('Choose the contact to use', 'CONTACT_REQUIRED')
      if (!(await db.contact.findFirst({ where: { id: input.contactId, workspaceId, deletedAt: null } }))) throw notFound('Contact not found')
    }
    const updated = await runAction(
      { action: 'contact.import.resolve', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { rowNumber: row.rowNumber, ...input }, target: { type: 'import', id: importId } },
      async (tx) => {
        await lockPreview(tx, workspaceId, importId, 'contacts')
        if (!(await tx.importRow.findFirst({ where: { id: rowId, batchId: importId } }))) throw conflict('This preview changed. Reload its rows.', 'IMPORT_CHANGED')
        await tx.importRow.update({ where: { id: rowId }, data: { resolution: input.action, resolvedContactId: input.action === 'use' ? input.contactId! : null } })
        return { value: await recount(tx, importId) }
      },
    )
    return toImport(updated)
  }

  async cancel(ctx: WorkspaceCtx, workspaceId: string, importId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.import')
    const batch = await loadBatch(workspaceId, importId)
    if (batch.status !== 'previewed') throw conflict('Only a previewed import can be cancelled', 'IMPORT_NOT_PREVIEWED')
    const now = new Date()
    const cancelled = await runAction(
      { action: 'contact.import.cancel', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'import', id: importId } },
      async (tx) => {
        await lockPreview(tx, workspaceId, importId, 'contacts')
        await tx.importRow.updateMany({ where: { batchId: importId }, data: { raw: Prisma.DbNull, values: Prisma.DbNull } })
        return { value: await tx.importBatch.update({ where: { id: importId }, data: { status: 'cancelled', finishedAt: now, rowsPrunedAt: now } }) }
      },
    )
    return toImport(cancelled)
  }

  /**
   * Applies the reviewed preview. Idempotent: a completed import returns as is; an
   * interrupted one continues with the rows that have no outcome yet.
   */
  async commit(ctx: WorkspaceCtx, workspaceId: string, importId: string, input: { createView?: boolean; viewTitle?: string } = {}) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.import')
    const batch = await db.$transaction(async tx => {
      const current = await lockImport(tx, workspaceId, importId, 'contacts')
      if (current.status === 'completed') return current
      if (current.status === 'cancelled') throw conflict('This import was cancelled', 'IMPORT_CANCELLED')
      if (current.rowsPrunedAt) throw conflict('This import’s rows were pruned', 'IMPORT_PRUNED')
      const unresolved = await tx.importRow.count({ where: { batchId: importId, proposal: 'review', resolution: null } })
      if (unresolved) throw httpError(409, `${unresolved} row(s) need a decision before import`, 'IMPORT_NEEDS_REVIEW')
      return current.status === 'previewed'
        ? tx.importBatch.update({ where: { id: importId }, data: { status: 'committing', committedAt: new Date() } })
        : current
    })
    if (batch.status === 'completed') return toImport(batch)

    const options = batch.options as Options
    for (;;) {
      const done = await db.$transaction(
        async (tx) => {
          // One import (chunk) at a time per workspace: matching and creating can't interleave.
          await tx.$queryRaw`SELECT id FROM Workspace WHERE id = ${workspaceId} FOR UPDATE`
          const rows = await tx.importRow.findMany({ where: { batchId: importId, outcome: null }, orderBy: { rowNumber: 'asc' }, take: CHUNK })
          for (const row of rows) await this.apply(tx, workspaceId, batch, options, actor.member.id, row)
          await recount(tx, importId)
          return rows.length < CHUNK
        },
        { timeout: 60_000 },
      )
      if (done) break
    }

    let resultDocumentId = batch.resultDocumentId
    if (input.createView && !resultDocumentId) {
      const view = await documents.create(ctx, workspaceId, {
        title: input.viewTitle?.trim() || `Imported contacts — ${batch.filename ?? 'sheet'}`,
        idempotencyKey: `import-view:${importId}`,
        descriptor: { surface: 'grid', source: { kind: 'dataset', datasetKey: 'contacts', datasetVersion: 1, query: { columns: [...DEFAULT_VIEW_COLUMNS], filters: { importBatchId: importId }, sort: { field: 'displayName', direction: 'asc' } } } },
      })
      resultDocumentId = view.id
    }

    const finished = await runAction(
      { action: 'contact.import.commit', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { createView: input.createView === true }, target: { type: 'import', id: importId } },
      async (tx) => {
        const current = await lockImport(tx, workspaceId, importId, 'contacts')
        if (current.status === 'completed') return { value: current }
        const counted = await recount(tx, importId)
        const counts = counted.counts as Counts
        const completed = await tx.importBatch.update({ where: { id: importId }, data: { status: 'completed', finishedAt: new Date(), resultDocumentId } })
        return {
          value: completed,
          result: { created: counts.created, matched: counts.matched, skipped: counts.skipped, resultDocumentId },
          activities: [{ type: 'import.completed', summary: { importId, filename: batch.filename, created: counts.created, matched: counts.matched, skipped: counts.skipped } }],
        }
      },
    )
    return toImport(finished)
  }

  // Decide and apply one row. Existing contacts are never modified (no silent overwrite
  // of later human changes); a "create" proposal is re-checked against the matcher so a
  // contact added since the preview isn't duplicated.
  private async apply(tx: Tx, workspaceId: string, batch: ImportBatch, options: Options, memberId: string, row: ImportRow) {
    const set = (outcome: 'created' | 'matched' | 'skipped', contactId: string | null, outcomeNote: string | null = null) =>
      tx.importRow.update({ where: { id: row.id }, data: { outcome, contactId, outcomeNote } })
    const values = (row.values as Values | null) ?? {}

    if (row.resolution === 'skip') return set('skipped', null, 'SKIPPED') // a person's decision
    if (row.proposal === 'invalid') return set('skipped', null, row.errorCode)
    if (row.proposal === 'duplicate') {
      const original = await tx.importRow.findUnique({ where: { batchId_rowNumber: { batchId: batch.id, rowNumber: row.duplicateOfRow! } } })
      return original?.contactId ? set('matched', original.contactId, 'DUPLICATE_ROW') : set('skipped', null, 'DUPLICATE_ROW')
    }
    if (row.resolution === 'use' || (!row.resolution && row.proposal === 'match')) {
      const target = await liveTarget(tx, workspaceId, row.resolution === 'use' ? row.resolvedContactId : row.proposedContactId)
      return target ? set('matched', target.id) : set('skipped', null, 'CONTACT_GONE')
    }
    if (!row.resolution) {
      // proposal "create": has anyone created this person since the preview?
      if (values.externalId && options.externalProvider) {
        const existing = await tx.contact.findFirst({ where: { workspaceId, deletedAt: null, externalProvider: options.externalProvider, externalId: values.externalId } })
        if (existing) return set('matched', existing.id, 'MATCHED_AT_COMMIT')
      }
      if (values.email) {
        const now = await matchContactsByEmail(tx, workspaceId, values.email)
        if (now.result === 'match') return set('matched', now.matchId, 'MATCHED_AT_COMMIT')
      }
    }

    const pointInputs: PointInput[] = [
      ...(values.email ? [{ kind: 'email' as const, value: values.email, shared: isRoleAddress(normalizeEmail(values.email)) }] : []),
      ...(values.phone ? [{ kind: 'phone' as const, value: values.phone }] : []),
    ]
    const points = preparePoints(pointInputs)
    const contact = await tx.contact.create({
      data: {
        leadStatus: await defaultContactStage(tx, workspaceId),
        workspaceId,
        firstName: values.firstName?.slice(0, 80) ?? null,
        lastName: values.lastName?.slice(0, 80) ?? null,
        displayName: displayNameOf({ displayName: values.displayName, firstName: values.firstName, lastName: values.lastName }, points),
        title: values.title?.slice(0, 120) ?? null,
        ownerMemberId: options.ownerMemberId ?? null,
        origin: 'import',
        importBatchId: batch.id,
        externalProvider: values.externalId && options.externalProvider ? options.externalProvider : null,
        externalId: values.externalId && options.externalProvider ? values.externalId.slice(0, 255) : null,
        createdById: memberId,
      },
    })
    await writePoints(tx, workspaceId, contact.id, points)
    if (options.tagIds?.length) await replaceTags(tx, 'contact', workspaceId, contact.id, options.tagIds)

    let note: string | null = null
    if (values.accountName) {
      const name = values.accountName.slice(0, 160)
      // Exact name, case-insensitive (the column's collation); several → don't guess.
      const accounts = await tx.account.findMany({ where: { workspaceId, deletedAt: null, name }, select: { id: true }, take: 2 })
      const accountId =
        accounts.length === 1 ? accounts[0]!.id
        : accounts.length === 0 ? (await tx.account.create({ data: { workspaceId, name, origin: 'import', createdById: memberId } })).id
        : null
      if (accountId) await tx.contactAccount.create({ data: { workspaceId, contactId: contact.id, accountId, isPrimary: true } })
      else note = 'ACCOUNT_AMBIGUOUS'
    }
    return set('created', contact.id, note)
  }
}
