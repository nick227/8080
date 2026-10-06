// Import through the combined model (doc/10 §7A): an ordinary sheet import never
// touches contacts; "import as contacts" previews through the one matcher, takes
// review decisions, commits idempotently in chunks and opens a live view.
// Also covers the Documents seam additions: recency order, Google file ids and
// keyset dataset paging.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { randomUUID } from 'crypto'
import { buildTestApp, validateResponse, testUserId } from './helpers'
import { caller, carolId, createWorkspace, daveId, join, seedPeople } from './helpers/workspace'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'
import { pruneImports } from '../services/ContactImportService'

const app = buildTestApp()
const call = caller(app)

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  const carol = await join(app, ws.id, carolId, 'carol@test.local')
  await join(app, ws.id, daveId, 'dave@test.local')
  const base = `/workspaces/${ws.id}`
  return { ws, base, carol, imports: `${base}/contact-imports` }
}

async function contact(base: string, displayName: string, email?: string, extra: object = {}) {
  const res = await call(testUserId, 'POST', `${base}/contacts`, { displayName, points: email ? [{ kind: 'email', value: email }] : [], ...extra })
  if (res.statusCode !== 201) throw new Error(res.body)
  return res.json().data
}

async function preview(imports: string, csv: string, extra: object = {}, as = carolId) {
  const res = await call(as, 'POST', imports, { source: { kind: 'csv', csv, filename: 'leads.csv' }, ...extra })
  if (res.statusCode !== 201) throw new Error(`${res.statusCode} ${res.body}`)
  return res.json().data
}

async function rowsOf(imports: string, id: string, query = '') {
  const res = await call(carolId, 'GET', `${imports}/${id}/rows?limit=100${query}`)
  return res.json().data as any[]
}

const CSV = [
  'First Name,Last Name,Email,Company,Job Title',
  'Ada,Lovelace,ada@engines.io,Engines,CTO', // new person, new company
  'Grace,Hopper,grace@navy.mil,Navy,Admiral', // already a contact → match
  'Lee,Twin,lee@acme.com,Acme,', // two contacts hold it → review
  'Front,Desk,info@acme.com,Acme,', // only a shared address → review
  'Ada,Lovelace,ADA@engines.io,Engines,', // repeats the same identity → duplicate
  'Bad,Mail,not-an-email,,', // invalid
  ',,,,', // nothing to identify a person → invalid
  'Charles,Babbage,,Engines,', // no email → create
].join('\n')

describe('ordinary sheet import vs. canonical contact import', () => {
  it('a sheet import creates no contacts; importing that sheet as contacts previews per row', async () => {
    const { base, imports } = await setup()
    await contact(base, 'Grace Hopper', 'grace@navy.mil')
    await contact(base, 'Lee One', 'lee@acme.com')
    await contact(base, 'Lee Two', 'lee@acme.com')
    await contact(base, 'Reception', 'info@acme.com')

    const sheet = await call(carolId, 'POST', `${base}/documents/import-csv`, { title: 'Leads', csv: CSV, filename: 'leads.csv', idempotencyKey: randomUUID() })
    expect(sheet.statusCode).toBe(201)
    expect(await db.contact.count()).toBe(4) // the sheet is only a sheet

    const res = await call(carolId, 'POST', imports, { source: { kind: 'document', documentId: sheet.json().data.id } })
    expect(res.statusCode).toBe(201)
    await validateResponse('createContactImport', 201, res.json())
    const imp = res.json().data
    expect(imp).toMatchObject({ status: 'previewed', totalRows: 8, source: { kind: 'document', documentId: sheet.json().data.id }, previousImportId: null })
    expect(Object.values(imp.mapping).sort()).toEqual(['accountName', 'email', 'firstName', 'lastName', 'title']) // suggested from headers
    expect(imp.counts).toMatchObject({ create: 2, match: 1, review: 2, duplicate: 1, invalid: 2, unresolved: 2, created: 0 })

    const rows = await call(carolId, 'GET', `${imports}/${imp.id}/rows?limit=100`)
    await validateResponse('listContactImportRows', 200, rows.json())
    expect(rows.json().data.map((r: any) => [r.rowNumber, r.proposal, r.errorCode, r.duplicateOfRow])).toEqual([
      [1, 'create', null, null],
      [2, 'match', null, null],
      [3, 'review', 'AMBIGUOUS_EMAIL', null],
      [4, 'review', 'SHARED_ADDRESS', null],
      [5, 'duplicate', null, 1],
      [6, 'invalid', 'INVALID_EMAIL', null],
      [7, 'invalid', 'EMPTY_CONTACT', null],
      [8, 'create', null, null],
    ])
    expect(rows.json().data[2].candidates.map((c: any) => c.displayName).sort()).toEqual(['Lee One', 'Lee Two'])
    expect(await db.contact.count()).toBe(4) // preview writes nothing to contacts
  })

  it('commit needs every review row decided, then creates, matches without overwriting, and opens a live view', async () => {
    const { base, imports, carol } = await setup()
    const grace = await contact(base, 'Grace Hopper', 'grace@navy.mil')
    const lee = await contact(base, 'Lee One', 'lee@acme.com')
    await contact(base, 'Lee Two', 'lee@acme.com')
    await contact(base, 'Reception', 'info@acme.com')
    const acme = (await call(testUserId, 'POST', `${base}/accounts`, { name: 'Acme' })).json().data
    const vip = (await call(carolId, 'POST', `${base}/tags`, { name: 'Imported' })).json().data
    const imp = await preview(imports, CSV, { options: { ownerMemberId: carol, tagIds: [vip.id] } })
    const rows = await rowsOf(imports, imp.id)

    expect((await call(carolId, 'POST', `${imports}/${imp.id}/commit`, {})).json().code).toBe('IMPORT_NEEDS_REVIEW')
    const decided = await call(carolId, 'PUT', `${imports}/${imp.id}/rows/${rows[2].id}/resolution`, { action: 'use', contactId: lee.id })
    expect(decided.statusCode).toBe(200)
    await validateResponse('resolveContactImportRow', 200, decided.json())
    await call(carolId, 'PUT', `${imports}/${imp.id}/rows/${rows[3].id}/resolution`, { action: 'skip' })
    expect((await call(carolId, 'PUT', `${imports}/${imp.id}/rows/${rows[5].id}/resolution`, { action: 'create' })).json().code).toBe('INVALID_ROW')
    expect((await call(carolId, 'PUT', `${imports}/${imp.id}/rows/${rows[4].id}/resolution`, { action: 'skip' })).json().code).toBe('DUPLICATE_ROW')

    const committed = await call(carolId, 'POST', `${imports}/${imp.id}/commit`, { createView: true })
    expect(committed.statusCode).toBe(200)
    await validateResponse('commitContactImport', 200, committed.json())
    const done = committed.json().data
    expect(done).toMatchObject({ status: 'completed', counts: { created: 2, matched: 3, skipped: 3 } })

    const outcomes = (await rowsOf(imports, imp.id)).map((r) => [r.rowNumber, r.outcome, r.outcomeNote, r.contact?.displayName ?? null])
    expect(outcomes).toEqual([
      [1, 'created', null, 'Ada Lovelace'],
      [2, 'matched', null, 'Grace Hopper'],
      [3, 'matched', null, 'Lee One'],
      [4, 'skipped', 'SKIPPED', null],
      [5, 'matched', 'DUPLICATE_ROW', 'Ada Lovelace'],
      [6, 'skipped', 'INVALID_EMAIL', null],
      [7, 'skipped', 'EMPTY_CONTACT', null],
      [8, 'created', null, 'Charles Babbage'],
    ])
    // Matched contacts are untouched; created ones carry provenance, owner, tags, points and an account.
    expect((await db.contact.findUniqueOrThrow({ where: { id: grace.id } })).title).toBeNull()
    const ada = await db.contact.findFirstOrThrow({ where: { displayName: 'Ada Lovelace' }, include: { points: true, accounts: { include: { account: true } }, tags: true } })
    expect(ada).toMatchObject({ origin: 'import', importBatchId: imp.id, ownerMemberId: carol, title: 'CTO', primaryEmail: 'ada@engines.io' })
    expect(ada.accounts.map((a) => [a.account.name, a.account.origin, a.isPrimary])).toEqual([['Engines', 'import', true]])
    expect(ada.tags.map((t) => t.tagId)).toEqual([vip.id])
    const babbage = await db.contact.findFirstOrThrow({ where: { displayName: 'Charles Babbage' }, include: { accounts: true } })
    expect(babbage.accounts[0]!.accountId).toBe(ada.accounts[0]!.accountId) // same company, one account
    expect(await db.account.count({ where: { name: 'Acme' } })).toBe(1)
    expect(acme.id).toBeTruthy()

    // The live view shows what this import created — current values, not a copy.
    const view = await call(carolId, 'POST', `${base}/documents/${done.resultDocumentId}/query`, {})
    expect(view.statusCode, view.body).toBe(200)
    expect(view.json().data.map((r: any) => r.cells.displayName)).toEqual(['Ada Lovelace', 'Charles Babbage'])
    await call(carolId, 'PATCH', `${base}/contacts/${ada.id}`, { displayName: 'Augusta Ada King' })
    expect((await call(carolId, 'POST', `${base}/documents/${done.resultDocumentId}/query`, {})).json().data.map((r: any) => r.cells.displayName)).toEqual(['Augusta Ada King', 'Charles Babbage'])

    // One timeline entry for the import, not one per contact; one audited commit.
    expect(await db.activity.count({ where: { type: 'import.completed' } })).toBe(1)
    expect(await db.actionExecution.count({ where: { action: 'contact.import.commit', status: 'succeeded' } })).toBe(1)
  })

  it('commit is idempotent and resumable, and concurrent commits create each contact once', async () => {
    const { imports } = await setup()
    const lines = ['Name,Email', ...Array.from({ length: 150 }, (_, i) => `Person ${i},p${i}@bulk.io`)]
    const imp = await preview(imports, lines.join('\n'))
    const [a, b] = await Promise.all([1, 2].map(() => call(carolId, 'POST', `${imports}/${imp.id}/commit`, {})))
    expect([a!.statusCode, b!.statusCode]).toEqual([200, 200])
    expect(await db.contact.count()).toBe(150) // two chunks, two callers, no duplicates
    const again = await call(carolId, 'POST', `${imports}/${imp.id}/commit`, {})
    expect(again.json().data).toMatchObject({ status: 'completed', counts: { created: 150 } })
    expect(await db.contact.count()).toBe(150)
  })

  it('re-importing the same file warns and matches instead of duplicating; a contact added after preview is matched', async () => {
    const { base, imports } = await setup()
    const csv = 'Name,Email\nAda,ada@x.io\nBo,bo@x.io'
    const first = await preview(imports, csv)
    await call(carolId, 'POST', `${imports}/${first.id}/commit`, {})
    const second = await preview(imports, csv)
    expect(second.previousImportId).toBe(first.id)
    expect(second.counts).toMatchObject({ match: 2, create: 0 })

    const third = await preview(imports, 'Name,Email\nCy,cy@x.io')
    expect(third.counts.create).toBe(1)
    const cy = await contact(base, 'Cy (added meanwhile)', 'cy@x.io')
    await call(carolId, 'POST', `${imports}/${third.id}/commit`, {})
    const [row] = await rowsOf(imports, third.id)
    expect(row).toMatchObject({ outcome: 'matched', outcomeNote: 'MATCHED_AT_COMMIT', contact: { id: cy.id } })
    expect(await db.contact.count({ where: { primaryEmail: 'cy@x.io' } })).toBe(1)
  })

  it('external ids match first; mappings are validated and re-run the preview', async () => {
    const { base, imports } = await setup()
    const known = await contact(base, 'Known', 'old@x.io', { externalProvider: 'hubspot', externalId: 'H-1' })
    const csv = 'Record ID,Name,Email\nH-1,Known,new@x.io\nH-2,Fresh,fresh@x.io'
    const plain = await preview(imports, csv)
    expect(plain.counts).toMatchObject({ create: 2 }) // id column not mapped, new@ unknown

    const remapped = await call(carolId, 'PATCH', `${imports}/${plain.id}`, { mapping: { ...plain.mapping, c1: 'externalId' }, options: { externalProvider: 'hubspot' } })
    expect(remapped.statusCode).toBe(200)
    await validateResponse('updateContactImport', 200, remapped.json())
    expect(remapped.json().data.counts).toMatchObject({ match: 1, create: 1 })
    expect((await rowsOf(imports, plain.id))[0]).toMatchObject({ proposal: 'match', proposedContactId: known.id })

    const bad = async (mapping: object, options: object = {}) => (await call(carolId, 'PATCH', `${imports}/${plain.id}`, { mapping, options })).json().code
    expect(await bad({ c9: 'email' })).toBe('INVALID_MAPPING') // unknown column
    expect(await bad({ c2: 'email', c3: 'email' })).toBe('INVALID_MAPPING') // field twice
    expect(await bad({ c1: 'title' })).toBe('INVALID_MAPPING') // nothing identifies a person
    expect(await bad({ c1: 'externalId', c2: 'displayName' }, { externalProvider: null })).toBe('INVALID_MAPPING')
  })

  it('sources are access-checked; cancelled and pruned imports keep provenance but drop row values', async () => {
    const { base, imports } = await setup()
    const daves = await call(daveId, 'POST', `${base}/documents/import-csv`, { title: 'Dave’s private sheet', csv: 'Name\nX', filename: 'x.csv', idempotencyKey: randomUUID() })
    expect((await call(carolId, 'POST', imports, { source: { kind: 'document', documentId: daves.json().data.id } })).statusCode).toBe(404)
    const view = await call(carolId, 'POST', `${base}/documents`, { title: 'Live', idempotencyKey: randomUUID(), descriptor: { surface: 'grid', source: { kind: 'dataset', datasetKey: 'contacts', datasetVersion: 1, query: { columns: ['id'] } } } })
    expect((await call(carolId, 'POST', imports, { source: { kind: 'document', documentId: view.json().data.id } })).json().code).toBe('NOT_A_SHEET')

    const dropped = await preview(imports, 'Name\nNobody')
    const cancelled = await call(carolId, 'DELETE', `${imports}/${dropped.id}`)
    expect(cancelled.json().data).toMatchObject({ status: 'cancelled' })
    expect((await rowsOf(imports, dropped.id))[0].values).toBeNull()
    expect((await call(carolId, 'POST', `${imports}/${dropped.id}/commit`, {})).json().code).toBe('IMPORT_CANCELLED')

    const kept = await preview(imports, 'Name,Email\nAda,ada@x.io')
    await call(carolId, 'POST', `${imports}/${kept.id}/commit`, {})
    process.env.IMPORT_ROW_RETENTION_DAYS = '0'
    try {
      expect(await pruneImports(new Date(Date.now() + 1000))).toBeGreaterThanOrEqual(1)
    } finally {
      delete process.env.IMPORT_ROW_RETENTION_DAYS
    }
    const [row] = await rowsOf(imports, kept.id)
    expect(row).toMatchObject({ values: null, outcome: 'created', contact: { displayName: 'Ada' } })
    expect((await call(carolId, 'GET', `${imports}/${kept.id}`)).json().data.rowsPrunedAt).toBeTruthy()
    expect((await db.contact.findFirstOrThrow({ where: { displayName: 'Ada' } })).importBatchId).toBe(kept.id)

    const list = await call(daveId, 'GET', imports)
    await validateResponse('listContactImports', 200, list.json())
    expect(await crossWorkspaceViolations()).toEqual({})
  })
})

describe('Documents seam additions', () => {
  it('lists the most recently changed documents first, page by page', async () => {
    const { base } = await setup()
    const make = async (title: string) => (await call(carolId, 'POST', `${base}/documents`, { title, idempotencyKey: randomUUID(), descriptor: { surface: 'blocks', source: { kind: 'native', schemaVersion: 1 } } })).json().data
    const a = await make('A')
    await make('B')
    await make('C')
    await call(carolId, 'PATCH', `${base}/documents/${a.id}`, { expectedVersion: a.version, title: 'A (edited)' })
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const qs: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      const res = await call(carolId, 'GET', `${base}/documents?limit=2${qs}`)
      seen.push(...res.json().data.map((d: any) => d.title))
      cursor = res.json().meta.nextCursor
    } while (cursor)
    expect(seen).toEqual(['A (edited)', 'C', 'B'])
  })

  it('records the Google file id so a second link to the same file can be found', async () => {
    const { base } = await setup()
    const link = async (title: string, url: string) =>
      (await call(carolId, 'POST', `${base}/documents`, { title, idempotencyKey: randomUUID(), descriptor: { surface: 'external', source: { kind: 'external', provider: 'google_sheets', url } } })).json().data
    const first = await link('Budget', 'https://docs.google.com/spreadsheets/d/AbC123_x/edit')
    expect(first.externalFileId).toBe('AbC123_x')
    await link('Budget (again)', 'https://docs.google.com/spreadsheets/u/1/d/AbC123_x/view?resourcekey=k')
    const dupes = await call(carolId, 'GET', `${base}/documents?externalFileId=AbC123_x`)
    await validateResponse('listDocuments', 200, dupes.json())
    expect(dupes.json().data.map((d: any) => d.title).sort()).toEqual(['Budget', 'Budget (again)'])
  })

  it('dataset pages are keyset-based: a contact added mid-scroll neither repeats nor hides rows', async () => {
    const { base } = await setup()
    for (const name of ['Bea', 'Cy', 'Di', 'Ed']) await contact(base, name)
    const query = { columns: ['displayName'], sort: { field: 'displayName', direction: 'asc' } }
    const first = (await call(carolId, 'POST', `${base}/document-datasets/contacts/query`, { query, limit: 2 })).json()
    expect(first.data.map((r: any) => r.cells.displayName)).toEqual(['Bea', 'Cy'])
    await contact(base, 'Al') // sorts before the cursor: an offset would now repeat "Cy"
    const next = (await call(carolId, 'POST', `${base}/document-datasets/contacts/query`, { query, limit: 2, cursor: first.meta.nextCursor })).json()
    expect(next.data.map((r: any) => r.cells.displayName)).toEqual(['Di', 'Ed'])
    expect(next.meta.nextCursor).toBeNull()
  })
})
