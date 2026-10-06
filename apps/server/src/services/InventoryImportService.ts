// Inventory import (doc/13 slice 4): same ImportBatch engine as contacts, SKU match.
// Matched rows skip by default or update mapped non-empty fields when onMatch=update.
// Blank cells leave existing values unchanged (never clear). Quantity changes append a stock movement.
import { createHash } from 'crypto'
import { db, Prisma, type ImportBatch, type ImportProposal, type ImportResolution, type ImportRow } from '@project/db'
import type { GridTable } from '@project/shared'
import { badRequest, conflict, httpError, notFound } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { runAction } from './actions'
import { DocumentService } from './DocumentService'
import { parseDocumentCsv } from './documentCsv'
import { isLowStock } from './InventoryService'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize } from './workspacePolicy'
import { lockImport, lockPreview } from './importState'
import { retentionDays } from './ContactImportService'

type Tx = Prisma.TransactionClient
const documents = new DocumentService()

export const INVENTORY_IMPORT_FIELDS = ['name', 'sku', 'description', 'price', 'category', 'quantity', 'availability'] as const
export type InventoryImportField = (typeof INVENTORY_IMPORT_FIELDS)[number]
type Mapping = Record<string, InventoryImportField>
type Options = { onMatch?: 'skip' | 'update' }
type Values = Partial<Record<InventoryImportField, string>>
type Source = { kind: 'csv'; csv: string; filename: string } | { kind: 'document'; documentId: string }
type Counts = { create: number; match: number; review: number; duplicate: number; invalid: number; unresolved: number; created: number; matched: number; skipped: number }

const CHUNK = 100
const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue

const SUGGEST: [RegExp, InventoryImportField][] = [
  [/^(name|item|product|title|item ?name|product ?name)$/, 'name'],
  [/^(sku|code|item ?code|product ?code|part ?number|pn)$/, 'sku'],
  [/^(description|desc|details|notes)$/, 'description'],
  [/^(price|unit ?price|cost|amount)$/, 'price'],
  [/^(category|type|group|family)$/, 'category'],
  [/^(quantity|qty|stock|on ?hand|inventory)$/, 'quantity'],
  [/^(availability|available|offered|status|active)$/, 'availability'],
]

export function suggestInventoryMapping(columns: { id: string; label: string }[]): Mapping {
  const mapping: Mapping = {}
  const used = new Set<InventoryImportField>()
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

function validateMapping(mapping: Mapping, columns: { id: string }[]): Mapping {
  const ids = new Set(columns.map((c) => c.id))
  const seen = new Set<InventoryImportField>()
  for (const [columnId, field] of Object.entries(mapping)) {
    if (!ids.has(columnId)) throw badRequest(`Unknown column "${columnId}"`, 'INVALID_MAPPING')
    if (!INVENTORY_IMPORT_FIELDS.includes(field)) throw badRequest(`Unknown inventory field "${field}"`, 'INVALID_MAPPING')
    if (seen.has(field)) throw badRequest(`"${field}" is mapped twice`, 'INVALID_MAPPING')
    seen.add(field)
  }
  if (!seen.has('name') && !seen.has('sku')) throw badRequest('Map at least a name or SKU', 'INVALID_MAPPING')
  return mapping
}

const hashTable = (table: GridTable) =>
  createHash('sha256')
    .update(JSON.stringify([table.columns.map((c) => c.label), table.rows.map((r) => table.columns.map((c) => r.cells[c.id] ?? ''))]))
    .digest('hex')

function parsePrice(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined
  if (!raw.trim()) return null
  const n = Number(raw.replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

function parseQuantity(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined
  if (!raw.trim()) return null
  const n = Number(raw.trim())
  if (!Number.isInteger(n) || n < 0) return undefined
  return n
}

function parseAvailability(raw: string | undefined): boolean | undefined {
  if (raw === undefined || !raw.trim()) return undefined
  const v = raw.trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 'offered', 'available', 'active'].includes(v)) return true
  if (['false', '0', 'no', 'n', 'paused', 'unavailable', 'inactive'].includes(v)) return false
  return undefined
}

type Planned = Omit<Prisma.ImportRowCreateManyInput, 'batchId' | 'workspaceId'>

async function plan(workspaceId: string, table: GridTable, mapping: Mapping): Promise<Planned[]> {
  const fieldColumn = Object.fromEntries(Object.entries(mapping).map(([col, field]) => [field, col])) as Partial<
    Record<InventoryImportField, string>
  >
  const valuesOf = (cells: Record<string, string | null>): Values =>
    Object.fromEntries(
      INVENTORY_IMPORT_FIELDS.flatMap((f) => {
        const v = fieldColumn[f] ? cells[fieldColumn[f]!]?.trim() : undefined
        return v ? [[f, v]] : []
      }),
    )
  const rows = table.rows.map((r, i) => ({ rowNumber: i + 1, sourceRowId: r.id, raw: r.cells, values: valuesOf(r.cells) }))
  const skus = [...new Set(rows.map((r) => r.values.sku?.trim()).filter(Boolean) as string[])]
  const existing = skus.length
    ? await db.inventory.findMany({ where: { workspaceId, sku: { in: skus } }, select: { id: true, sku: true, name: true } })
    : []
  const bySku = new Map(existing.map((item) => [item.sku!, item]))
  const seenSku = new Map<string, number>()
  return rows.map((row) => {
    const name = row.values.name?.trim()
    const sku = row.values.sku?.trim()
    if (sku && seenSku.has(sku)) {
      return {
        rowNumber: row.rowNumber,
        sourceRowId: row.sourceRowId,
        raw: row.raw as Prisma.InputJsonValue,
        values: row.values as Prisma.InputJsonValue,
        proposal: 'duplicate' as ImportProposal,
        duplicateOfRow: seenSku.get(sku)!,
        candidateIds: [],
      }
    }
    if (sku) seenSku.set(sku, row.rowNumber)
    if (!name && !sku) {
      return {
        rowNumber: row.rowNumber,
        sourceRowId: row.sourceRowId,
        raw: row.raw as Prisma.InputJsonValue,
        values: row.values as Prisma.InputJsonValue,
        proposal: 'invalid' as ImportProposal,
        errorCode: 'EMPTY_ITEM',
        candidateIds: [],
      }
    }
    if (row.values.price !== undefined && parsePrice(row.values.price) === undefined) {
      return {
        rowNumber: row.rowNumber,
        sourceRowId: row.sourceRowId,
        raw: row.raw as Prisma.InputJsonValue,
        values: row.values as Prisma.InputJsonValue,
        proposal: 'invalid' as ImportProposal,
        errorCode: 'INVALID_PRICE',
        candidateIds: [],
      }
    }
    if (row.values.quantity !== undefined && parseQuantity(row.values.quantity) === undefined) {
      return {
        rowNumber: row.rowNumber,
        sourceRowId: row.sourceRowId,
        raw: row.raw as Prisma.InputJsonValue,
        values: row.values as Prisma.InputJsonValue,
        proposal: 'invalid' as ImportProposal,
        errorCode: 'INVALID_QUANTITY',
        candidateIds: [],
      }
    }
    if (row.values.availability !== undefined && parseAvailability(row.values.availability) === undefined) {
      return {
        rowNumber: row.rowNumber,
        sourceRowId: row.sourceRowId,
        raw: row.raw as Prisma.InputJsonValue,
        values: row.values as Prisma.InputJsonValue,
        proposal: 'invalid' as ImportProposal,
        errorCode: 'INVALID_AVAILABILITY',
        candidateIds: [],
      }
    }
    if (!name) {
      return {
        rowNumber: row.rowNumber,
        sourceRowId: row.sourceRowId,
        raw: row.raw as Prisma.InputJsonValue,
        values: row.values as Prisma.InputJsonValue,
        proposal: 'invalid' as ImportProposal,
        errorCode: 'EMPTY_NAME',
        candidateIds: [],
      }
    }
    const hit = sku ? bySku.get(sku) : undefined
    if (hit) {
      return {
        rowNumber: row.rowNumber,
        sourceRowId: row.sourceRowId,
        raw: row.raw as Prisma.InputJsonValue,
        values: row.values as Prisma.InputJsonValue,
        proposal: 'match' as ImportProposal,
        proposedContactId: hit.id,
        candidateIds: [hit.id],
      }
    }
    return {
      rowNumber: row.rowNumber,
      sourceRowId: row.sourceRowId,
      raw: row.raw as Prisma.InputJsonValue,
      values: row.values as Prisma.InputJsonValue,
      proposal: 'create' as ImportProposal,
      candidateIds: [],
    }
  })
}

async function recount(tx: Tx, batchId: string) {
  const rows = await tx.importRow.findMany({ where: { batchId }, select: { proposal: true, resolution: true, outcome: true } })
  const counts: Counts = {
    create: 0,
    match: 0,
    review: 0,
    duplicate: 0,
    invalid: 0,
    unresolved: 0,
    created: 0,
    matched: 0,
    skipped: 0,
  }
  for (const row of rows) {
    counts[row.proposal]++
    if (row.proposal === 'review' && !row.resolution) counts.unresolved++
    if (row.outcome === 'created') counts.created++
    if (row.outcome === 'matched') counts.matched++
    if (row.outcome === 'skipped') counts.skipped++
  }
  return tx.importBatch.update({ where: { id: batchId }, data: { counts: json(counts), totalRows: rows.length } })
}

async function previousImportId(batch: ImportBatch) {
  const prior = await db.importBatch.findFirst({
    where: { workspaceId: batch.workspaceId, kind: 'inventory', sourceHash: batch.sourceHash, status: 'completed', id: { not: batch.id } },
    orderBy: { finishedAt: 'desc' },
  })
  return prior?.id ?? null
}

async function toImport(batch: ImportBatch) {
  return {
    id: batch.id,
    workspaceId: batch.workspaceId,
    kind: batch.kind,
    status: batch.status,
    source: {
      kind: batch.sourceDocumentId ? ('document' as const) : ('csv' as const),
      documentId: batch.sourceDocumentId,
      filename: batch.filename,
    },
    columns: batch.columns,
    mapping: batch.mapping,
    options: batch.options,
    totalRows: batch.totalRows,
    counts: batch.counts,
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
  const batch = await db.importBatch.findFirst({ where: { id: importId, workspaceId, kind: 'inventory' } })
  if (!batch) throw notFound('Import not found')
  return batch
}

export class InventoryImportService {
  async list(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'record.read')
    const batches = await db.importBatch.findMany({
      where: { workspaceId, kind: 'inventory' },
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
    const cutoff = new Date(Date.now() - retentionDays() * 86_400_000)
    await db.importBatch.updateMany({
      where: { workspaceId, kind: 'inventory', status: 'previewed', updatedAt: { lt: cutoff } },
      data: { status: 'cancelled', finishedAt: new Date() },
    })
    const options: Options = { onMatch: input.options?.onMatch === 'update' ? 'update' : 'skip' }
    let table: GridTable
    let filename: string | null = null
    let sourceDocumentId: string | null = null
    if (input.source.kind === 'csv') {
      table = parseDocumentCsv(input.source.csv)
      filename = input.source.filename.trim() || 'import.csv'
    } else {
      const { row } = await documents.access(ctx.user.id, workspaceId, input.source.documentId)
      if (!row.payload) throw badRequest('Only a spreadsheet with imported rows can be imported as inventory', 'NOT_A_SHEET')
      table = row.payload as unknown as GridTable
      sourceDocumentId = row.id
    }
    if (!table.rows.length) throw badRequest('The table has no data rows', 'EMPTY_IMPORT')
    const columns = table.columns.map((c) => ({ id: c.id, label: c.label }))
    const mapping = validateMapping(input.mapping ?? suggestInventoryMapping(columns), columns)
    const planned = await plan(workspaceId, table, mapping)
    const sourceHash = hashTable(table)
    const batch = await runAction(
      {
        action: 'inventory.import.preview',
        workspaceId,
        actor: memberActor(actor),
        origin: ctx.origin,
        input: { source: input.source.kind, filename, sourceDocumentId, sourceHash, mapping, options, rows: planned.length },
        target: { type: 'import' },
      },
      async (tx) => {
        const created = await tx.importBatch.create({
          data: {
            workspaceId,
            kind: 'inventory',
            sourceDocumentId,
            filename,
            sourceHash,
            columns: json(columns),
            mapping: json(mapping),
            options: json(options),
            counts: json({}),
            createdById: actor.member.id,
          },
        })
        await tx.importRow.createMany({ data: planned.map((r) => ({ ...r, batchId: created.id, workspaceId })) })
        return { value: await recount(tx, created.id), targetId: created.id }
      },
    )
    return toImport(batch)
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, importId: string, input: { mapping?: Mapping; options?: Options }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.import')
    const batch = await loadBatch(workspaceId, importId)
    if (batch.status !== 'previewed') throw conflict('Only a previewed import can change', 'IMPORT_NOT_PREVIEWED')
    if (batch.rowsPrunedAt) throw conflict('This import’s rows were pruned', 'IMPORT_PRUNED')
    const prior = (batch.options as Options).onMatch === 'update' ? 'update' : 'skip'
    const options: Options = { onMatch: input.options?.onMatch ?? prior }
    const columns = batch.columns as { id: string; label: string }[]
    const mapping = validateMapping(input.mapping ?? (batch.mapping as Mapping), columns)
    const stored = await db.importRow.findMany({
      where: { batchId: importId },
      orderBy: { rowNumber: 'asc' },
      select: { sourceRowId: true, raw: true },
    })
    const table: GridTable = {
      columns: columns.map((c) => ({ ...c, type: 'text' })),
      rows: stored.map((r, i) => ({ id: r.sourceRowId ?? `r${i + 1}`, cells: r.raw as Record<string, string | null> })),
    }
    const planned = await plan(workspaceId, table, mapping)
    const updated = await runAction(
      {
        action: 'inventory.import.remap',
        workspaceId,
        actor: memberActor(actor),
        origin: ctx.origin,
        input: { mapping, options },
        target: { type: 'import', id: importId },
      },
      async (tx) => {
        await lockPreview(tx, workspaceId, importId, 'inventory', batch.updatedAt)
        await tx.importRow.deleteMany({ where: { batchId: importId } })
        await tx.importRow.createMany({ data: planned.map((r) => ({ ...r, batchId: importId, workspaceId })) })
        await tx.importBatch.update({ where: { id: importId }, data: { mapping: json(mapping), options: json(options) } })
        return { value: await recount(tx, importId), changes: { mapping: [batch.mapping, mapping] } }
      },
    )
    return toImport(updated)
  }

  async rows(
    userId: string,
    workspaceId: string,
    importId: string,
    opts: { proposal?: ImportProposal; outcome?: 'created' | 'matched' | 'skipped'; cursor?: string; limit?: number },
  ) {
    await authorize(userId, workspaceId, 'record.read')
    await loadBatch(workspaceId, importId)
    const limit = normalizeLimit(opts.limit)
    const cursor = decodeKeyCursor<{ n: number }>(opts.cursor)
    if (cursor && !Number.isInteger(cursor.n)) throw badRequest('Invalid cursor')
    const rows = await db.importRow.findMany({
      where: {
        batchId: importId,
        ...(opts.proposal ? { proposal: opts.proposal } : {}),
        ...(opts.outcome ? { outcome: opts.outcome } : {}),
        ...(cursor ? { rowNumber: { gt: cursor.n } } : {}),
      },
      orderBy: { rowNumber: 'asc' },
      take: limit + 1,
    })
    const result = page(rows, limit, (last) => encodeKeyCursor({ n: last.rowNumber }))
    const ids = [
      ...new Set(
        result.data.flatMap((r) => [
          ...((r.candidateIds as string[] | null) ?? []),
          ...(r.inventoryId ? [r.inventoryId] : []),
          ...(r.proposedContactId ? [r.proposedContactId] : []),
        ]),
      ),
    ]
    const refs = new Map(
      (ids.length ? await db.inventory.findMany({ where: { id: { in: ids }, workspaceId } }) : []).map((item) => [
        item.id,
        { id: item.id, name: item.name, sku: item.sku },
      ]),
    )
    return {
      data: result.data.map((r) => ({
        id: r.id,
        rowNumber: r.rowNumber,
        sourceRowId: r.sourceRowId,
        values: (r.values as Values | null) ?? null,
        proposal: r.proposal,
        errorCode: r.errorCode,
        candidates: ((r.candidateIds as string[] | null) ?? []).flatMap((id) => (refs.has(id) ? [refs.get(id)!] : [])),
        proposedInventoryId: r.proposedContactId,
        duplicateOfRow: r.duplicateOfRow,
        resolution: r.resolution,
        resolvedInventoryId: r.resolvedContactId,
        outcome: r.outcome,
        outcomeNote: r.outcomeNote,
        item: r.inventoryId && refs.has(r.inventoryId) ? refs.get(r.inventoryId)! : null,
      })),
      meta: result.meta,
    }
  }

  async resolve(ctx: WorkspaceCtx, workspaceId: string, importId: string, rowId: string, input: { action: ImportResolution; inventoryId?: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.import')
    const batch = await loadBatch(workspaceId, importId)
    if (batch.status !== 'previewed') throw conflict('Only a previewed import can change', 'IMPORT_NOT_PREVIEWED')
    const row = await db.importRow.findFirst({ where: { id: rowId, batchId: importId } })
    if (!row) throw notFound('Row not found')
    if (row.proposal === 'duplicate') throw badRequest('A repeated row follows the row it repeats', 'DUPLICATE_ROW')
    if (row.proposal === 'invalid' && input.action !== 'skip') throw badRequest('An invalid row can only be skipped', 'INVALID_ROW')
    if (input.action === 'use') {
      if (!input.inventoryId) throw badRequest('Choose the item to use', 'INVENTORY_REQUIRED')
      if (!(await db.inventory.findFirst({ where: { id: input.inventoryId, workspaceId } }))) throw notFound('Item not found')
    }
    const updated = await runAction(
      {
        action: 'inventory.import.resolve',
        workspaceId,
        actor: memberActor(actor),
        origin: ctx.origin,
        input: { rowNumber: row.rowNumber, ...input },
        target: { type: 'import', id: importId },
      },
      async (tx) => {
        await lockPreview(tx, workspaceId, importId, 'inventory')
        if (!(await tx.importRow.findFirst({ where: { id: rowId, batchId: importId } }))) throw conflict('This preview changed. Reload its rows.', 'IMPORT_CHANGED')
        await tx.importRow.update({
          where: { id: rowId },
          data: { resolution: input.action, resolvedContactId: input.action === 'use' ? input.inventoryId! : null },
        })
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
      { action: 'inventory.import.cancel', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'import', id: importId } },
      async (tx) => {
        await lockPreview(tx, workspaceId, importId, 'inventory')
        await tx.importRow.updateMany({ where: { batchId: importId }, data: { raw: Prisma.DbNull, values: Prisma.DbNull } })
        return { value: await tx.importBatch.update({ where: { id: importId }, data: { status: 'cancelled', finishedAt: now, rowsPrunedAt: now } }) }
      },
    )
    return toImport(cancelled)
  }

  async commit(ctx: WorkspaceCtx, workspaceId: string, importId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.import')
    const batch = await db.$transaction(async tx => {
      const current = await lockImport(tx, workspaceId, importId, 'inventory')
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
          await tx.$queryRaw`SELECT id FROM Workspace WHERE id = ${workspaceId} FOR UPDATE`
          const rows = await tx.importRow.findMany({ where: { batchId: importId, outcome: null }, orderBy: { rowNumber: 'asc' }, take: CHUNK })
          for (const row of rows) await this.apply(tx, workspaceId, batch, options, row)
          await recount(tx, importId)
          return rows.length < CHUNK
        },
        { timeout: 60_000 },
      )
      if (done) break
    }
    const finished = await runAction(
      { action: 'inventory.import.commit', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'import', id: importId } },
      async (tx) => {
        const current = await lockImport(tx, workspaceId, importId, 'inventory')
        if (current.status === 'completed') return { value: current }
        const counted = await recount(tx, importId)
        const counts = counted.counts as Counts
        const completed = await tx.importBatch.update({ where: { id: importId }, data: { status: 'completed', finishedAt: new Date() } })
        return {
          value: completed,
          result: { created: counts.created, matched: counts.matched, skipped: counts.skipped },
          activities: [
            {
              type: 'import.completed',
              summary: { importId, kind: 'inventory', filename: batch.filename, created: counts.created, matched: counts.matched, skipped: counts.skipped },
            },
          ],
        }
      },
    )
    return toImport(finished)
  }

  private async apply(tx: Tx, workspaceId: string, batch: ImportBatch, options: Options, row: ImportRow) {
    const set = (outcome: 'created' | 'matched' | 'skipped', inventoryId: string | null, outcomeNote: string | null = null) =>
      tx.importRow.update({ where: { id: row.id }, data: { outcome, inventoryId, outcomeNote } })
    const values = (row.values as Values | null) ?? {}
    if (row.resolution === 'skip') return set('skipped', null, 'SKIPPED')
    if (row.proposal === 'invalid') return set('skipped', null, row.errorCode)
    if (row.proposal === 'duplicate') {
      const original = await tx.importRow.findUnique({ where: { batchId_rowNumber: { batchId: batch.id, rowNumber: row.duplicateOfRow! } } })
      return original?.inventoryId ? set('matched', original.inventoryId, 'DUPLICATE_ROW') : set('skipped', null, 'DUPLICATE_ROW')
    }
    const targetId = row.resolution === 'use' ? row.resolvedContactId : row.proposedContactId
    if (row.resolution === 'use' || (!row.resolution && row.proposal === 'match')) {
      const target = targetId ? await tx.inventory.findFirst({ where: { id: targetId, workspaceId } }) : null
      if (!target) return set('skipped', null, 'ITEM_GONE')
      if (options.onMatch === 'update') {
        // MVP: a fresh import is required to overwrite an item edited since preview.
        if (target.updatedAt > batch.createdAt) return set('skipped', target.id, 'ITEM_CHANGED')
        const price = parsePrice(values.price)
        const quantity = parseQuantity(values.quantity)
        const availability = parseAvailability(values.availability)
        const changed = await tx.inventory.updateMany({
          where: { id: target.id, workspaceId, version: target.version },
          data: {
            ...(values.name?.trim() ? { name: values.name.trim().slice(0, 160) } : {}),
            ...(values.description !== undefined ? { description: values.description.trim() || null } : {}),
            ...(price !== undefined && price !== null ? { price } : {}),
            ...(values.category !== undefined ? { category: values.category.trim() || null } : {}),
            ...(quantity !== undefined
              ? { quantity, lowStock: isLowStock(quantity, target.lowStockThreshold) }
              : {}),
            ...(availability !== undefined ? { availability } : {}),
            version: { increment: 1 },
          },
        })
        if (!changed.count) return set('skipped', target.id, 'ITEM_CHANGED')
        if (quantity !== undefined && quantity !== target.quantity) {
          const delta = target.quantity != null && quantity != null ? quantity - target.quantity : null
          await tx.inventoryStockMovement.create({
            data: {
              workspaceId,
              inventoryId: target.id,
              fromQuantity: target.quantity,
              toQuantity: quantity,
              delta,
              source: 'import',
              actorMemberId: batch.createdById,
            },
          })
        }
        return set('matched', target.id, 'UPDATED')
      }
      return set('matched', target.id)
    }
    const sku = values.sku?.trim() || null
    if (sku) {
      const existing = await tx.inventory.findFirst({ where: { workspaceId, sku } })
      if (existing) return set('matched', existing.id, 'MATCHED_AT_COMMIT')
    }
    const price = parsePrice(values.price) ?? 0
    const quantity = parseQuantity(values.quantity)
    const availability = parseAvailability(values.availability) ?? true
    const qty = quantity === undefined ? null : quantity
    try {
      const created = await tx.inventory.create({
        data: {
          workspaceId,
          name: (values.name ?? 'Untitled').trim().slice(0, 160),
          sku,
          description: values.description?.trim() || null,
          price: price === null ? 0 : price,
          category: values.category?.trim() || null,
          quantity: qty,
          lowStock: isLowStock(qty, null),
          availability,
          importBatchId: batch.id,
        },
      })
      if (qty != null) {
        await tx.inventoryStockMovement.create({
          data: {
            workspaceId,
            inventoryId: created.id,
            fromQuantity: null,
            toQuantity: qty,
            delta: null,
            source: 'import',
            actorMemberId: batch.createdById,
          },
        })
      }
      return set('created', created.id)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && sku) {
        const existing = await tx.inventory.findFirst({ where: { workspaceId, sku } })
        if (existing) return set('matched', existing.id, 'MATCHED_AT_COMMIT')
      }
      throw err
    }
  }
}
