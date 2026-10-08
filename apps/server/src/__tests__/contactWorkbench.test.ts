import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, validateResponse, testUserId, testOtherUserId } from './helpers'
import { caller, createWorkspace } from './helpers/workspace'

const app = buildTestApp()
const call = caller(app)
async function setup() {
  const ws = await createWorkspace(app)
  const base = `/workspaces/${ws.id}/contacts`
  const create = async (body: object) => {
    const res = await call(testUserId, 'POST', base, body)
    expect(res.statusCode, res.body).toBe(201)
    return res.json().data
  }
  return { ws, base, create }
}
async function walk(base: string, query: string) {
  const rows: any[] = []
  let cursor: string | null = null
  do {
    const res = await call(testUserId, 'GET', `${base}?${query}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    expect(res.statusCode, res.body).toBe(200)
    rows.push(...res.json().data)
    cursor = res.json().meta.nextCursor
    expect(rows.length).toBeLessThan(20)
  } while (cursor)
  return rows
}

describe('contact workbench', () => {
  it('persists independent milestones and numeric values, rejects stale writes, and logs outreach once', async () => {
    const { base, create } = await setup()
    const c = await create({ displayName: 'Dana', leadStatus: 'contacted', potentialValue: 1250.25 })
    expect(c).toMatchObject({ contacted: false, qualified: false, proposalSent: false, won: false, lastContactedAt: null, potentialValue: 1250.25 })
    const patch = await call(testUserId, 'PATCH', `${base}/${c.id}`, { expectedVersion: c.version, qualified: true, nextAction: 'Send pricing', interestedIn: 'Studio package', waitingOn: 'us' })
    expect(patch.statusCode, patch.body).toBe(200)
    expect(patch.json().data).toMatchObject({ qualified: true, contacted: false, leadStatus: 'contacted', nextAction: 'Send pricing', interestedIn: 'Studio package' })
    await validateResponse('updateContact', 200, patch.json())
    expect((await call(testUserId, 'PATCH', `${base}/${c.id}`, { expectedVersion: c.version, won: true })).statusCode).toBe(409)
    const logBody = { logContact: true, expectedVersion: patch.json().data.version, idempotencyKey: 'outreach-test' }
    const logged = await call(testUserId, 'PATCH', `${base}/${c.id}`, logBody)
    expect(logged.statusCode, logged.body).toBe(200)
    expect(logged.json().data.contacted).toBe(true)
    expect(logged.json().data.lastContactedAt).toBeTruthy()
    const replay = await call(testUserId, 'PATCH', `${base}/${c.id}`, logBody)
    expect(replay.json().data.lastContactedAt).toBe(logged.json().data.lastContactedAt)
    const timeline = await call(testUserId, 'GET', `${base}/${c.id}/timeline`)
    expect(timeline.json().data.filter((r: any) => r.type === 'contact.contacted')).toHaveLength(1)
    expect((await call(testUserId, 'PATCH', `${base}/${c.id}`, { potentialValue: -1 })).statusCode).toBe(400)
    expect((await call(testUserId, 'PATCH', `${base}/${c.id}`, { lastContactedAt: '2099-01-01T00:00:00Z' })).statusCode).toBe(400)
  })

  it('sorts nullable dates in both directions without losing null rows across pages', async () => {
    const { base, create } = await setup()
    await create({ displayName: 'B unset' })
    await create({ displayName: 'A unset' })
    await create({ displayName: 'Early', nextFollowUp: '2020-01-01T12:00:00Z', lastContactedAt: '2020-01-01T12:00:00Z' })
    await create({ displayName: 'Late', nextFollowUp: '2021-01-01T12:00:00Z', lastContactedAt: '2021-01-01T12:00:00Z' })
    expect((await walk(base, 'sort=followUp&dir=asc')).map(c => c.displayName)).toEqual(['Early', 'Late', 'A unset', 'B unset'])
    expect((await walk(base, 'sort=followUp&dir=desc')).map(c => c.displayName)).toEqual(['Late', 'Early', 'A unset', 'B unset'])
    expect((await walk(base, 'sort=lastContacted&dir=asc')).map(c => c.displayName)).toEqual(['A unset', 'B unset', 'Early', 'Late'])
    expect((await walk(base, 'sort=lastContacted&dir=desc')).map(c => c.displayName)).toEqual(['Late', 'Early', 'A unset', 'B unset'])
  })

  it('sorts checkboxes, pipeline order, numeric values and secondary keys across the whole result', async () => {
    const { base, create } = await setup()
    await create({ displayName: 'Zed', qualified: false, leadStatus: 'presentation', potentialValue: 20 })
    await create({ displayName: 'Amy', qualified: true, leadStatus: 'interested', potentialValue: 100 })
    await create({ displayName: 'Bea', qualified: false, leadStatus: 'contacted', potentialValue: 5 })
    expect((await walk(base, 'sort=qualified&dir=asc&thenSort=potentialValue&thenDir=desc')).map(c => c.displayName)).toEqual(['Zed', 'Bea', 'Amy'])
    expect((await walk(base, 'sort=qualified&dir=desc')).map(c => c.displayName)).toEqual(['Amy', 'Bea', 'Zed'])
    expect((await walk(base, 'sort=stage')).map(c => c.displayName)).toEqual(['Bea', 'Zed', 'Amy'])
    expect((await walk(base, 'sort=potentialValue')).map(c => c.displayName)).toEqual(['Bea', 'Zed', 'Amy'])
    expect((await walk(base, 'milestone=qualified&checked=false')).map(c => c.displayName)).toEqual(['Bea', 'Zed'])
    expect((await walk(base, 'focus=needsProposal')).map(c => c.displayName)).toEqual(['Amy'])
    const first = await call(testUserId, 'GET', `${base}?sort=qualified&limit=1`)
    expect((await call(testUserId, 'GET', `${base}?sort=name&cursor=${encodeURIComponent(first.json().meta.nextCursor)}`)).statusCode).toBe(400)
  })

  it('searches companies, interests and contact details with workspace isolation', async () => {
    const { ws, base, create } = await setup()
    const account = (await call(testUserId, 'POST', `/workspaces/${ws.id}/accounts`, { name: 'Cobalt Studio' })).json().data
    const linked = await create({ displayName: 'Dana', accounts: [{ accountId: account.id, isPrimary: true }], points: [{ kind: 'phone', value: '+1 555 222 3333' }, { kind: 'email', value: 'dana@example.test' }] })
    const interest = await create({ displayName: 'Eli', interestedIn: 'Cobalt lighting' })
    const other = await createWorkspace(app)
    await call(testUserId, 'POST', `/workspaces/${other.id}/contacts`, { displayName: 'Cobalt secret' })
    const result = await call(testUserId, 'GET', `${base}?q=Cobalt`)
    expect(result.json().data.map((c: any) => c.id)).toEqual([linked.id, interest.id])
    expect(result.json().meta.total).toBe(2)
    expect((await walk(base, 'q=222')).map(c => c.id)).toEqual([linked.id])
    expect((await walk(base, 'q=example.test')).map(c => c.id)).toEqual([linked.id])
    expect((await walk(base, 'sort=company')).map(c => c.id)).toEqual([linked.id, interest.id])
    expect((await call(testOtherUserId, 'GET', base)).statusCode).toBe(404)
  })

  it('loads workspace definitions, preserves values through renaming/archiving, validates types', async () => {
    const { ws, base, create } = await setup()
    await db.contactFieldDefinition.createMany({ data: [
      { workspaceId: ws.id, key: 'qualified', label: 'Good fit', type: 'checkbox', position: 1 },
      { workspaceId: ws.id, key: 'seats', label: 'Seat count', type: 'number', position: 11 },
      { workspaceId: ws.id, key: 'segment', label: 'Segment', type: 'select', options: [{ value: 'studio', label: 'Studio' }], position: 12 },
    ] })
    const fields = await call(testUserId, 'GET', `${base}/fields`)
    expect(fields.statusCode, fields.body).toBe(200)
    await validateResponse('listContactFields', 200, fields.json())
    expect(fields.json().data.find((f: any) => f.key === 'qualified').label).toBe('Good fit')
    const c = await create({ displayName: 'Dana', fieldValues: { seats: 4, segment: 'studio' } })
    expect((await call(testUserId, 'PATCH', `${base}/${c.id}`, { fieldValues: { seats: 'many' } })).statusCode).toBe(400)
    expect((await call(testUserId, 'PATCH', `${base}/${c.id}`, { fieldValues: { unknown: true } })).statusCode).toBe(400)
    const patched = await call(testUserId, 'PATCH', `${base}/${c.id}`, { fieldValues: { seats: 8 } })
    expect(patched.json().data.fieldValues).toEqual({ seats: 8, segment: 'studio' })
    await db.contactFieldDefinition.updateMany({ where: { workspaceId: ws.id, key: 'seats' }, data: { label: 'Team size', archived: true } })
    expect((await call(testUserId, 'GET', `${base}/${c.id}`)).json().data.fieldValues.seats).toBe(8)
    expect((await call(testUserId, 'PATCH', `${base}/${c.id}`, { fieldValues: { seats: 10 } })).statusCode).toBe(400)
    const other = await createWorkspace(app)
    expect((await call(testUserId, 'GET', `/workspaces/${other.id}/contacts/fields`)).json().data.some((f: any) => f.key === 'seats')).toBe(false)
  })
})
