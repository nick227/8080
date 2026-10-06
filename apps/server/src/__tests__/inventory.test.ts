// Inventory (what we sell) and interests (which contact wants which item), plus
// the lead-tracking fields on contacts.
import { describe, it, expect } from 'vitest'
import { buildTestApp, validateResponse, testUserId } from './helpers'
import { caller, carolId, createWorkspace, join, seedPeople } from './helpers/workspace'

const app = buildTestApp()
const call = caller(app)

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  await join(app, ws.id, carolId, 'carol@test.local')
  return { ws, base: `/workspaces/${ws.id}` }
}

const item = async (base: string, body: object) => {
  const res = await call(testUserId, 'POST', `${base}/inventory`, body)
  if (res.statusCode !== 201) throw new Error(`create item: ${res.statusCode} ${res.body}`)
  return res.json().data
}

describe('inventory', () => {
  it('creates, lists, updates and archives items; no quantity means a service', async () => {
    const { base } = await setup()
    const res = await call(testUserId, 'POST', `${base}/inventory`, { name: ' Window cleaning ', price: 80, category: 'Services' })
    expect(res.statusCode).toBe(201)
    await validateResponse('createInventoryItem', 201, res.json())
    const service = res.json().data
    expect(service).toMatchObject({ name: 'Window cleaning', price: 80, quantity: null, availability: true, status: 'active' })

    const widget = await item(base, { name: 'Widget', sku: 'W-1', price: 12.5, quantity: 40 })
    const list = await call(testUserId, 'GET', `${base}/inventory`)
    await validateResponse('listInventory', 200, list.json())
    expect(list.json().data.map((i: any) => i.name)).toEqual(['Widget', 'Window cleaning'])
    expect((await call(testUserId, 'GET', `${base}/inventory?q=W-`)).json().data.map((i: any) => i.id)).toEqual([widget.id])

    const patched = await call(testUserId, 'PATCH', `${base}/inventory/${widget.id}`, { expectedVersion: 1, price: 15, quantity: 0, status: 'archived' })
    expect(patched.json().data).toMatchObject({ price: 15, quantity: 0, status: 'archived', version: 2 })
    // Optimistic concurrency: the old version is refused, nothing is overwritten.
    const stale = await call(testUserId, 'PATCH', `${base}/inventory/${widget.id}`, { expectedVersion: 1, price: 99 })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().code).toBe('INVENTORY_VERSION_CONFLICT')
    expect((await call(testUserId, 'PATCH', `${base}/inventory/${widget.id}`, { price: 99 })).statusCode).toBe(400) // version required
    expect((await call(testUserId, 'GET', `${base}/inventory/${widget.id}`)).json().data).toMatchObject({ price: 15, version: 2 })
    expect((await call(testUserId, 'GET', `${base}/inventory`)).json().data.map((i: any) => i.name)).toEqual(['Window cleaning'])
    expect((await call(testUserId, 'GET', `${base}/inventory?status=archived`)).json().data).toHaveLength(1)
  })

  it('refuses a nameless item, a negative price and a repeated code', async () => {
    const { base } = await setup()
    expect((await call(testUserId, 'POST', `${base}/inventory`, { name: '   ' })).statusCode).toBe(400)
    expect((await call(testUserId, 'POST', `${base}/inventory`, { name: 'A', price: -1 })).statusCode).toBe(400)
    await item(base, { name: 'A', sku: 'X-1' })
    const dup = await call(testUserId, 'POST', `${base}/inventory`, { name: 'B', sku: 'X-1' })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().code ?? dup.json().error?.code).toBe('SKU_TAKEN')
  })

  it('keeps one workspace out of another', async () => {
    const a = await setup()
    const b = await setup()
    const mine = await item(a.base, { name: 'Private', sku: 'P-1' })
    expect((await call(testUserId, 'GET', `${b.base}/inventory/${mine.id}`)).statusCode).toBe(404)
    // the same code is fine in a different workspace
    expect((await call(testUserId, 'POST', `${b.base}/inventory`, { name: 'Other', sku: 'P-1' })).statusCode).toBe(201)
  })

  it('links a contact to items and drops them again, idempotently', async () => {
    const { base } = await setup()
    const lead = (await call(testUserId, 'POST', `${base}/contacts`, { displayName: 'Dana Ruiz' })).json().data
    const widget = await item(base, { name: 'Widget' })

    const first = await call(testUserId, 'POST', `${base}/contacts/${lead.id}/interests`, { inventoryId: widget.id })
    expect(first.statusCode).toBe(201)
    await validateResponse('addContactInterest', 201, first.json())
    const again = await call(testUserId, 'POST', `${base}/contacts/${lead.id}/interests`, { inventoryId: widget.id })
    expect(again.json().data.id).toBe(first.json().data.id)

    const listed = await call(testUserId, 'GET', `${base}/contacts/${lead.id}/interests`)
    await validateResponse('listContactInterests', 200, listed.json())
    expect(listed.json().data.map((i: any) => i.item.name)).toEqual(['Widget'])

    expect((await call(testUserId, 'DELETE', `${base}/contacts/${lead.id}/interests/${widget.id}`)).statusCode).toBe(200)
    expect((await call(testUserId, 'GET', `${base}/contacts/${lead.id}/interests`)).json().data).toEqual([])
  })
})

describe('lead tracking on contacts', () => {
  it('starts as new, moves through the pipeline and keeps source and follow-up', async () => {
    const { base } = await setup()
    const created = await call(testUserId, 'POST', `${base}/contacts`, { displayName: 'Lee Park', leadSource: 'Referral' })
    await validateResponse('createContact', 201, created.json())
    const lead = created.json().data
    expect(lead).toMatchObject({ leadStatus: 'new', leadSource: 'Referral', nextFollowUp: null })

    const when = '2030-01-15T09:00:00.000Z'
    const moved = await call(testUserId, 'PATCH', `${base}/contacts/${lead.id}`, { leadStatus: 'qualified', nextFollowUp: when })
    expect(moved.statusCode).toBe(200)
    await validateResponse('updateContact', 200, moved.json())
    expect(moved.json().data).toMatchObject({ leadStatus: 'qualified', leadSource: 'Referral' })
    expect(new Date(moved.json().data.nextFollowUp).toISOString()).toBe(when)

    const cleared = await call(testUserId, 'PATCH', `${base}/contacts/${lead.id}`, { nextFollowUp: null })
    expect(cleared.json().data).toMatchObject({ leadStatus: 'qualified', nextFollowUp: null })
    expect((await call(testUserId, 'PATCH', `${base}/contacts/${lead.id}`, { leadStatus: 'bogus' })).statusCode).toBe(400)
  })
})
