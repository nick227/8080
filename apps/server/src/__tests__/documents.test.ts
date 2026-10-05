import { describe, it, expect } from 'vitest'
import { randomUUID } from 'crypto'
import { db } from '@project/db'
import { buildTestApp, testUserId, testOtherUserId, seedRoom, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, daveId, join, seedPeople } from './helpers/workspace'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'
import { parseDocumentCsv, renderCsv } from '../services/documentCsv'
const app = buildTestApp()
const call = caller(app)
const native = { surface: 'blocks', source: { kind: 'native', schemaVersion: 1 } }
const query = { columns: ['id', 'displayName', 'title', 'primaryEmail', 'createdAt'] }
async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  const carol = await join(app, ws.id, carolId, 'carol@test.local')
  const dave = await join(app, ws.id, daveId, 'dave@test.local')
  return { ws, carol, dave, base: `/workspaces/${ws.id}`, docs: `/workspaces/${ws.id}/documents`, dataset: `/workspaces/${ws.id}/document-datasets/contacts` }
}
async function create(docs: string, descriptor: object = native, user = carolId, title = 'Business brief') {
  const res = await call(user, 'POST', docs, { title, descriptor, idempotencyKey: randomUUID() })
  expect(res.statusCode, res.body).toBe(201)
  await validateResponse('createDocument', 201, res.json())
  return res.json().data
}
async function contact(base: string, displayName: string) {
  const res = await call(testUserId, 'POST', base + '/contacts', { displayName })
  expect(res.statusCode, res.body).toBe(201)
  return res.json().data
}

describe('Documents registry and contracts', () => {
  it('persists the four surface/source combinations, caller capabilities and creator-only access', async () => {
    const { docs } = await setup()
    for (const descriptor of [native, { ...native, surface: 'mental_map' }, { ...native, surface: 'grid' }, { surface: 'grid', source: { kind: 'dataset', datasetKey: 'contacts', datasetVersion: 1, query } }, { surface: 'external', source: { kind: 'external', provider: 'google_docs', url: 'https://docs.google.com/document/d/abc123/edit?resourcekey=key' } }]) {
      const doc = await create(docs, descriptor)
      expect(doc.descriptor).toEqual(descriptor)
      expect(doc.capabilities).toMatchObject({ manageAccess: true, editContent: false, showNativePresence: false })
      expect((await call(daveId, 'GET', docs + '/' + doc.id)).statusCode).toBe(404)
      expect((await call(testOtherUserId, 'GET', docs + '/' + doc.id)).statusCode).toBe(404)
    }
    expect((await call(daveId, 'GET', docs)).json().data).toHaveLength(0)
    expect((await call(testUserId, 'GET', docs)).json().data).toHaveLength(5)
    expect(await crossWorkspaceViolations()).toEqual({})
  })
  it('rejects mismatched descriptors, unknown properties and deceptive external URLs', async () => {
    const { docs } = await setup()
    for (const descriptor of [
      { surface: 'blocks', source: { kind: 'dataset', datasetKey: 'contacts', datasetVersion: 1, query } },
      { surface: 'grid', source: { kind: 'native', schemaVersion: 2 } },
      { ...native, arbitraryEditorState: {} },
      ...['javascript:alert(1)', 'https://docs.google.com.evil.test/document/d/abc/edit', 'https://user:pass@docs.google.com/document/d/abc/edit', 'https://docs.google.com/spreadsheets/d/abc/edit', 'https://docs.google.com/document/d/abc/export'].map(url => ({ surface: 'external', source: { kind: 'external', provider: 'google_docs', url } })),
    ]) {
      expect((await call(carolId, 'POST', docs, { title: 'Bad', descriptor, idempotencyKey: randomUUID() })).statusCode).toBe(400)
    }
    const sheet = await create(docs, { surface: 'external', source: { kind: 'external', provider: 'google_sheets', url: 'https://docs.google.com/spreadsheets/d/abc/edit#gid=0' } })
    expect(sheet.capabilities.openExternal).toBe(true)
  })
  it('enforces grants, source immutability, conditional metadata updates, trash and restore', async () => {
    const { docs, dave } = await setup()
    const doc = await create(docs)
    const url = docs + '/' + doc.id
    expect((await call(carolId, 'PUT', url + '/grants/' + dave, { role: 'viewer' })).statusCode).toBe(200)
    const visible = await call(daveId, 'GET', url)
    expect(visible.json().data.capabilities).toMatchObject({ editMetadata: false, manageAccess: false })
    expect((await call(daveId, 'PATCH', url, { title: 'No', expectedVersion: 1 })).statusCode).toBe(403)
    await call(carolId, 'PUT', url + '/grants/' + dave, { role: 'editor' })
    const changed = await call(daveId, 'PATCH', url, { title: 'Updated', expectedVersion: 1 })
    expect(changed.statusCode, changed.body).toBe(200)
    expect((await call(carolId, 'PATCH', url, { title: 'Stale', expectedVersion: 1 })).statusCode).toBe(409)
    expect((await call(carolId, 'PATCH', url, { expectedVersion: 2, descriptor: { ...native, surface: 'grid' } })).statusCode).toBe(400)
    expect((await call(daveId, 'DELETE', url, { expectedVersion: 2 })).statusCode).toBe(403)
    const deleted = await call(carolId, 'DELETE', url, { expectedVersion: 2 })
    expect(deleted.json().data.deletedAt).toBeTruthy()
    expect((await call(carolId, 'GET', docs)).json().data).toHaveLength(0)
    expect((await call(carolId, 'GET', docs + '?deleted=true')).json().data).toHaveLength(1)
    expect((await call(carolId, 'POST', url + '/restore', { expectedVersion: 3 })).json().data.deletedAt).toBeNull()
    await call(carolId, 'DELETE', url + '/grants/' + dave)
    expect((await call(daveId, 'GET', url)).statusCode).toBe(404)
    await db.workspaceMember.update({ where: { id: dave }, data: { status: 'suspended' } })
    expect((await call(daveId, 'GET', docs)).statusCode).toBe(403)
  })
  it('replays create safely and rejects actor/key reuse', async () => {
    const { docs } = await setup()
    const body = { title: 'Once', descriptor: native, idempotencyKey: randomUUID() }
    const results = await Promise.all([call(carolId, 'POST', docs, body), call(carolId, 'POST', docs, body)])
    expect(results.map(r => r.statusCode)).toEqual([201, 201])
    expect(results[0]!.json().data.id).toBe(results[1]!.json().data.id)
    expect(await db.document.count()).toBe(1)
    expect((await call(daveId, 'POST', docs, body)).statusCode).toBe(409)
    expect((await call(carolId, 'POST', docs, { ...body, title: 'Other' })).statusCode).toBe(409)
  })
  it('filters both ends of Related/backlinks and resolves renamed targets', async () => {
    const { docs, dave } = await setup()
    const a = await create(docs), b = await create(docs, native, carolId, 'Related')
    const au = docs + '/' + a.id, bu = docs + '/' + b.id
    await call(carolId, 'PUT', au + '/grants/' + dave, { role: 'editor' })
    expect((await call(daveId, 'PUT', au + '/related/' + b.id)).statusCode).toBe(404)
    await call(carolId, 'PUT', au + '/related/' + b.id)
    await call(carolId, 'PUT', bu + '/related/' + a.id)
    expect(await db.documentRelation.count()).toBe(1)
    expect((await call(daveId, 'GET', au + '/related')).json().data).toHaveLength(0)
    await call(carolId, 'PUT', bu + '/grants/' + dave, { role: 'viewer' })
    await call(carolId, 'PATCH', bu, { title: 'New title', expectedVersion: 1 })
    const related = await call(daveId, 'GET', au + '/related')
    await validateResponse('listRelatedDocuments', 200, related.json())
    expect(related.json().data[0].document.title).toBe('New title')
    expect((await call(daveId, 'GET', bu + '/related')).json().data[0].document.id).toBe(a.id)
    await call(carolId, 'DELETE', bu, { expectedVersion: 2 })
    expect((await call(daveId, 'GET', au + '/related')).json().data).toHaveLength(0)
    await call(carolId, 'POST', bu + '/restore', { expectedVersion: 3 })
    expect((await call(daveId, 'GET', au + '/related')).json().data).toHaveLength(1)
    await call(daveId, 'DELETE', au + '/related/' + b.id)
    expect(await db.documentRelation.count()).toBe(0)
  })
  it('rejects cross-workspace grants and relations; room links never grant access or own documents', async () => {
    const { ws, docs, dave } = await setup()
    const second = await createWorkspace(app, testUserId, { name: 'Other' })
    const other = await create(`/workspaces/${second.id}/documents`, native, testUserId)
    const doc = await create(docs, native, testUserId)
    const url = docs + '/' + doc.id
    expect((await call(testUserId, 'PUT', `/workspaces/${second.id}/documents/${other.id}/grants/${dave}`, { role: 'viewer' })).statusCode).toBe(404)
    expect((await call(testUserId, 'PUT', url + '/related/' + other.id)).statusCode).toBe(404)
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    await call(testUserId, 'PUT', url + '/rooms/' + room.id)
    await call(testUserId, 'PUT', url + '/grants/' + dave, { role: 'viewer' })
    expect((await call(daveId, 'GET', url + '/rooms')).json().data).toHaveLength(0)
    expect((await call(daveId, 'GET', docs + '?roomId=' + room.id)).statusCode).toBe(404)
    expect((await call(testUserId, 'GET', docs + '?roomId=' + room.id)).json().data).toHaveLength(1)
    await db.room.update({ where: { id: room.id }, data: { deletedAt: new Date() } })
    expect((await call(testUserId, 'GET', url)).statusCode).toBe(200)
    expect(await crossWorkspaceViolations()).toEqual({})
    expect((await call(testOtherUserId, 'GET', `/workspaces/${ws.id}/documents`)).statusCode).toBe(404)
  })
})

describe('Canonical Contacts dataset', () => {
  it('queries dates/columns with totals and cursor binding; exports all matches with a consistent manifest', async () => {
    const { base, dataset } = await setup()
    const a = await contact(base, 'Alpha'), b = await contact(base, '=SUM(A1)'), c = await contact(base, 'Later')
    await db.contact.update({ where: { id: a.id }, data: { createdAt: new Date('2026-09-01T00:00:00Z') } })
    await db.contact.update({ where: { id: b.id }, data: { createdAt: new Date('2026-09-30T23:59:59Z') } })
    await db.contact.update({ where: { id: c.id }, data: { createdAt: new Date('2026-10-01T00:00:00Z') } })
    const filtered = { ...query, filters: { date: { field: 'createdAt', from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' } } }
    const first = await call(carolId, 'POST', dataset + '/query', { query: filtered, limit: 1 })
    expect(first.statusCode, first.body).toBe(200)
    await validateResponse('queryContactsDataset', 200, first.json())
    expect(first.json().meta.total).toBe(2)
    expect(first.json().manifest.complete).toBe(false)
    const next = await call(carolId, 'POST', dataset + '/query', { query: filtered, limit: 1, cursor: first.json().meta.nextCursor })
    expect(next.json().data[0].id).not.toBe(first.json().data[0].id)
    expect(next.json().meta.nextCursor).toBeNull()
    expect((await call(carolId, 'POST', dataset + '/query', { query, cursor: first.json().meta.nextCursor })).statusCode).toBe(400)
    const exported = await call(carolId, 'POST', dataset + '/export', { query: filtered })
    await validateResponse('exportContactsDataset', 200, exported.json())
    expect(exported.json().data.manifest).toMatchObject({ rowCount: 2, complete: true })
    expect(exported.json().data.csv).toContain("'=SUM(A1)")
    expect(exported.json().data.csv).not.toContain('Later')
    expect((await call(carolId, 'POST', dataset + '/query', { query: { ...query, filters: { date: { field: 'createdAt', from: '2026-10-01T00:00:00Z', to: '2026-09-01T00:00:00Z' } } } })).statusCode).toBe(400)
  })
  it('writes through ContactService, detects concurrent/stale edits, replays once and refuses derived fields', async () => {
    const { base, dataset, docs, dave } = await setup()
    const c = await contact(base, 'Original')
    const doc = await create(docs, { surface: 'grid', source: { kind: 'dataset', datasetKey: 'contacts', datasetVersion: 1, query } })
    const url = docs + '/' + doc.id
    await call(carolId, 'PUT', url + '/grants/' + dave, { role: 'viewer' })
    const payload = { expectedVersion: c.version, idempotencyKey: randomUUID(), changes: { firstName: 'Real', lastName: 'Name' } }
    expect((await call(daveId, 'PATCH', url + '/rows/' + c.id, payload)).statusCode).toBe(403)
    const result = await call(carolId, 'PATCH', url + '/rows/' + c.id, payload)
    expect(result.statusCode, result.body).toBe(200)
    await validateResponse('updateDocumentDatasetRow', 200, result.json())
    expect(result.json().data.displayName).toBe('Real Name')
    const again = await call(carolId, 'PATCH', url + '/rows/' + c.id, payload)
    expect(again.statusCode, again.body).toBe(200)
    expect(again.json()).toEqual(result.json())
    expect(await db.actionExecution.count({ where: { action: 'contact.update', status: 'succeeded' } })).toBe(1)
    const normal = await call(carolId, 'GET', base + '/contacts/' + c.id)
    expect(normal.json().data.displayName).toBe('Real Name')
    expect((await call(carolId, 'PATCH', dataset + '/rows/' + c.id, { ...payload, idempotencyKey: randomUUID() })).statusCode).toBe(409)
    expect((await call(carolId, 'PATCH', dataset + '/rows/' + c.id, { ...payload, changes: { primaryEmail: 'x@example.test' } })).statusCode).toBe(400)
    const version = result.json().data.version
    const races = await Promise.all(['One', 'Two'].map(title => call(carolId, 'PATCH', dataset + '/rows/' + c.id, { expectedVersion: version, idempotencyKey: randomUUID(), changes: { title } })))
    expect(races.map(r => r.statusCode).sort()).toEqual([200, 409])
  })
  it('creates retry-safe review copies without a writeback capability, retaining captured values', async () => {
    const { base, dataset, docs } = await setup()
    const c = await contact(base, 'Captured')
    const input = { title: 'Review', query, idempotencyKey: randomUUID() }
    const created = await call(carolId, 'POST', dataset + '/review-copy', input)
    expect(created.statusCode, created.body).toBe(201)
    const doc = created.json().data
    expect(doc.descriptor).toEqual({ surface: 'grid', source: { kind: 'native', schemaVersion: 1 } })
    expect(doc.capabilities).toMatchObject({ editRecords: false, queryDataset: false, readMaterialization: true })
    await call(carolId, 'PATCH', base + '/contacts/' + c.id, { displayName: 'Changed' })
    const replay = await call(carolId, 'POST', dataset + '/review-copy', input)
    expect(replay.json().data.id).toBe(doc.id)
    const snapshot = await call(carolId, 'GET', docs + '/' + doc.id + '/materialization')
    await validateResponse('getDocumentMaterialization', 200, snapshot.json())
    expect(snapshot.json().data.table.rows[0].cells.displayName).toBe('Captured')
    expect((await call(carolId, 'POST', docs + '/' + doc.id + '/query', {})).statusCode).toBe(400)
    expect((await call(daveId, 'GET', docs + '/' + doc.id + '/materialization')).statusCode).toBe(404)
  })
  it('publishes the dataset contract and rejects arbitrary sources/fields', async () => {
    const { base, dataset } = await setup()
    const catalog = await call(carolId, 'GET', base + '/document-datasets')
    await validateResponse('listDocumentDatasets', 200, catalog.json())
    expect(catalog.json().data[0].columns.find((c: any) => c.key === 'primaryEmail').writable).toBe(false)
    expect((await call(carolId, 'POST', dataset + '/query', { query: { columns: ['passwordHash'] } })).statusCode).toBe(400)
    expect((await call(carolId, 'POST', dataset + '/query', { query: { columns: ['id', 'id'] } })).statusCode).toBe(400)
  })
})

describe('CSV foundations', () => {
  it('imports strings, escaped quotes and multiline fields with idempotency and no CRM mutations', async () => {
    const { docs } = await setup()
    const input = { title: 'Imported', filename: 'customers.csv', csv: 'Code,Notes\r\n0012,"Line one\nLine ""two"""\r\n', idempotencyKey: randomUUID() }
    const result = await call(carolId, 'POST', docs + '/import-csv', input)
    expect(result.statusCode, result.body).toBe(201)
    const doc = result.json().data
    const replay = await call(carolId, 'POST', docs + '/import-csv', input)
    expect(replay.json().data.id).toBe(doc.id)
    const material = (await call(carolId, 'GET', docs + '/' + doc.id + '/materialization')).json().data
    expect(material.table.rows[0].cells).toEqual({ c1: '0012', c2: 'Line one\nLine "two"' })
    expect(await db.contact.count()).toBe(0)
  })
  it('rejects malformed CSV and neutralizes spreadsheet formulas on export', () => {
    for (const csv of ['A,A\n1,2', 'A,B\n1', 'A\n"unclosed', 'A\n"closed"oops']) expect(() => parseDocumentCsv(csv)).toThrow()
    expect(parseDocumentCsv('A,B\n,0').rows[0]!.cells).toEqual({ c1: '', c2: '0' })
    expect(renderCsv(['A'], [[' =1+1'], ['@command'], ['normal']])).toContain("' =1+1")
  })
})
