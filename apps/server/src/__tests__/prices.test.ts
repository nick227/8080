// doc/13 A4 — exact inventory prices: integer minor units + currency are the price;
// decimals are converted once and refused when too precise. (The legacy float and its
// backfill were retired after production verified mismatched: 0.)
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId, validateResponse } from './helpers'
import { caller, createWorkspace, seedPeople } from './helpers/workspace'
import { toMinor } from '../lib/money'

const app = buildTestApp()
const call = caller(app)
beforeEach(async () => { await seedPeople() })

async function setup(body: object = { name: 'Acme Co' }) {
  const ws = await createWorkspace(app, testUserId, body)
  return { ws, base: `/workspaces/${ws.id}` }
}
const create = (base: string, body: object) => call(testUserId, 'POST', `${base}/inventory`, body)

describe('exact prices', () => {
  it('converts decimals exactly (19.99, 0.1 + 0.2 style)', async () => {
    expect([toMinor(19.99, 'USD'), toMinor(0.3, 'USD'), toMinor(1.005, 'USD'), toMinor(1200, 'JPY'), toMinor(1.5, 'JPY')]).toEqual([1999, 30, null, 1200, null])
    const { base } = await setup()
    const res = await create(base, { name: 'Lens', price: 19.99 })
    expect(res.statusCode).toBe(201)
    await validateResponse('createInventoryItem', 201, res.json())
    expect(res.json().data).toMatchObject({ price: 19.99, priceMinor: 1999, currency: 'USD' })
    const row = await db.inventory.findUniqueOrThrow({ where: { id: res.json().data.id } })
    expect([row.priceMinor, row.currency]).toEqual([1999, 'USD'])

    const item = res.json().data
    const upd = await call(testUserId, 'PATCH', `${base}/inventory/${item.id}`, { expectedVersion: item.version, price: 0.3 })
    expect(upd.json().data).toMatchObject({ price: 0.3, priceMinor: 30 })
  })

  it('refuses a price more precise than the currency; a zero-decimal currency takes whole amounts', async () => {
    const { base } = await setup()
    expect((await create(base, { name: 'Bolt', price: 12.345 })).json().code).toBe('INVALID_PRICE')
    const yen = await setup({ name: 'Tokyo Co', defaultCurrency: 'JPY' })
    expect((await create(yen.base, { name: 'Tea', price: 1200 })).json().data).toMatchObject({ price: 1200, priceMinor: 1200, currency: 'JPY' })
    expect((await create(yen.base, { name: 'Tea', price: 1.5 })).json().code).toBe('INVALID_PRICE')
  })

  it('sorts by the exact price and computes stock value in whole cents', async () => {
    const { base } = await setup()
    for (const [name, price, quantity] of [['A', 0.1, 3], ['B', 10, 1], ['C', 2.5, 2]] as const) await create(base, { name, price, quantity })
    const sorted = (await call(testUserId, 'GET', `${base}/inventory?sort=price&dir=desc`)).json().data.map((i: any) => i.name)
    expect(sorted).toEqual(['B', 'C', 'A'])
    const doc = (await call(testUserId, 'POST', `${base}/sheets`, { idempotencyKey: 'p1', query: { source: 'inventory', columns: ['name', 'stockValue'], sort: { field: 'stockValue', direction: 'asc' } } })).json().data
    const content = (await call(testUserId, 'GET', `${base}/documents/${doc.id}/content`)).json().data.content
    expect(content.rows.map((r: any) => [r.cells.name, r.cells.stockValue])).toEqual([['A', 30], ['C', 500], ['B', 1000]]) // 0.1 × 3 = 30 cents, not 30.000000000000004
  })
})
