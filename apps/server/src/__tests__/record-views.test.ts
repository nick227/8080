import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildTestApp, testUserId } from './helpers'
import { caller, carolId, createWorkspace, join, memberId, seedPeople } from './helpers/workspace'

const app = buildTestApp()
const call = caller(app)

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  await join(app, ws.id, carolId, 'carol@test.local')
  return { base: `/workspaces/${ws.id}`, alice: await memberId(ws.id, testUserId) }
}

// "Due today" and "overdue" are workspace-local days (UTC here). The clock is frozen at
// mid-day UTC so the boundary never moves under the test (it failed after 7 pm Central).
// Only Date is faked; timers run normally.
const NOON_UTC = new Date('2026-10-06T12:00:00.000Z')
afterEach(() => { vi.useRealTimers() })

describe('record collection views', () => {
  it('counts contact working views and filters overdue / unassigned by server rules', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOON_UTC)
    const { base, alice } = await setup()
    const today = new Date(NOON_UTC)
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    await call(testUserId, 'POST', `${base}/contacts`, {
      displayName: 'Due today',
      nextFollowUp: today.toISOString(),
      ownerMemberId: alice,
    })
    await call(testUserId, 'POST', `${base}/contacts`, {
      displayName: 'Overdue lead',
      nextFollowUp: yesterday.toISOString(),
      ownerMemberId: alice,
    })
    await call(testUserId, 'POST', `${base}/contacts`, {
      displayName: 'Lost overdue ignored',
      leadStatus: 'not_interested',
      nextFollowUp: yesterday.toISOString(),
      ownerMemberId: alice,
    })
    await call(testUserId, 'POST', `${base}/contacts`, { displayName: 'Unassigned person' })

    const counts = await call(testUserId, 'GET', `${base}/contacts/counts`)
    expect(counts.statusCode).toBe(200)
    expect(counts.json().data).toMatchObject({ all: 4, due: 1, overdue: 1, unassigned: 1, archived: 0 })

    const overdue = await call(testUserId, 'GET', `${base}/contacts?focus=overdue`)
    expect(overdue.json().data.map((row: { displayName: string }) => row.displayName)).toEqual(['Overdue lead'])
    expect(overdue.json().meta.total).toBe(1)

    const unassigned = await call(testUserId, 'GET', `${base}/contacts?focus=unassigned`)
    expect(unassigned.json().data.map((row: { displayName: string }) => row.displayName)).toEqual(['Unassigned person'])

    const named = await call(testUserId, 'GET', `${base}/contacts?sort=name&dir=desc`)
    expect(named.json().data.map((row: { displayName: string }) => row.displayName)).toEqual([
      'Unassigned person',
      'Overdue lead',
      'Lost overdue ignored',
      'Due today',
    ])

    const overdueId = overdue.json().data[0].id
    const unassignedId = unassigned.json().data[0].id
    const bulk = await call(testUserId, 'POST', `${base}/contacts/bulk`, {
      ids: [overdueId, unassignedId],
      action: 'setStage',
      leadStatus: 'interested',
    })
    expect(bulk.json().data.updated).toBe(2)
    expect((await call(testUserId, 'GET', `${base}/contacts/${overdueId}`)).json().data.leadStatus).toBe('interested')
  })

  it('sorts inventory, counts stock views, bulks availability, and lists reverse interests', async () => {
    const { base } = await setup()
    const cheap = (
      await call(testUserId, 'POST', `${base}/inventory`, { name: 'Alpha cheap', price: 5, quantity: 0 })
    ).json().data
    const dear = (
      await call(testUserId, 'POST', `${base}/inventory`, { name: 'Beta dear', price: 50, availability: false })
    ).json().data
    const lead = (await call(testUserId, 'POST', `${base}/contacts`, { displayName: 'Buyer' })).json().data
    await call(testUserId, 'POST', `${base}/contacts/${lead.id}/interests`, { inventoryId: cheap.id })

    const priced = await call(testUserId, 'GET', `${base}/inventory?sort=price&dir=desc`)
    expect(priced.json().data.map((row: { name: string }) => row.name)).toEqual(['Beta dear', 'Alpha cheap'])
    expect(priced.json().meta.total).toBe(2)

    const counts = await call(testUserId, 'GET', `${base}/inventory/counts`)
    expect(counts.json().data).toMatchObject({ all: 2, offered: 1, paused: 1, outOfStock: 1, low: 0, archived: 0 })

    const bulk = await call(testUserId, 'POST', `${base}/inventory/bulk`, {
      ids: [cheap.id, dear.id],
      action: 'setAvailability',
      availability: true,
    })
    expect(bulk.json().data.updated).toBe(2)
    expect((await call(testUserId, 'GET', `${base}/inventory/${dear.id}`)).json().data.availability).toBe(true)

    const interested = await call(testUserId, 'GET', `${base}/inventory/${cheap.id}/interests`)
    expect(interested.json().data.map((row: { contact: { displayName: string } }) => row.contact.displayName)).toEqual([
      'Buyer',
    ])
  })
})
