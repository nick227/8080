import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, join, seedPeople } from './helpers/workspace'

const app = buildTestApp()
const call = caller(app)

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  await join(app, ws.id, carolId, 'carol@test.local')
  return { base: `/workspaces/${ws.id}`, imports: `/workspaces/${ws.id}/inventory-imports` }
}

const CSV = [
  'Name,SKU,Price,Quantity,Availability',
  'Lens kit,LENS-01,120,3,offered',
  'Studio light,LIGHT-02,240,0,paused',
  'Lens kit dupe,LENS-01,99,,',
  'Bad price,BAD-1,-5,,',
  ',,,,',
  'Untracked mic,MIC-03,40,,yes',
].join('\n')

describe('inventory import', () => {
  it('previews create / match / duplicate / invalid and commits with optional SKU updates', async () => {
    const { base, imports } = await setup()
    await call(testUserId, 'POST', `${base}/inventory`, { name: 'Existing light', sku: 'LIGHT-02', price: 200, quantity: 5 })

    const preview = await call(carolId, 'POST', imports, {
      source: { kind: 'csv', csv: CSV, filename: 'stock.csv' },
      options: { onMatch: 'update' },
    })
    expect(preview.statusCode).toBe(201)
    await validateResponse('createInventoryImport', 201, preview.json())
    const imp = preview.json().data
    expect(imp).toMatchObject({
      kind: 'inventory',
      status: 'previewed',
      totalRows: 6,
      counts: { create: 2, match: 1, review: 0, duplicate: 1, invalid: 2, unresolved: 0 },
    })
    expect(Object.values(imp.mapping).sort()).toEqual(['availability', 'name', 'price', 'quantity', 'sku'])

    const rows = await call(carolId, 'GET', `${imports}/${imp.id}/rows?limit=100`)
    await validateResponse('listInventoryImportRows', 200, rows.json())
    expect(rows.json().data.map((r: { proposal: string; errorCode: string | null }) => [r.proposal, r.errorCode])).toEqual([
      ['create', null],
      ['match', null],
      ['duplicate', null],
      ['invalid', 'INVALID_PRICE'],
      ['invalid', 'EMPTY_ITEM'],
      ['create', null],
    ])

    const committed = await call(carolId, 'POST', `${imports}/${imp.id}/commit`)
    expect(committed.statusCode).toBe(200)
    expect(committed.json().data).toMatchObject({
      status: 'completed',
      counts: { created: 2, matched: 2, skipped: 2 },
    })

    const light = (await call(testUserId, 'GET', `${base}/inventory?q=LIGHT-02`)).json().data[0]
    expect(light).toMatchObject({ name: 'Studio light', price: 240, quantity: 0, availability: false })

    const items = (await call(testUserId, 'GET', `${base}/inventory?sort=name`)).json().data
    expect(items.map((row: { name: string; sku: string | null }) => [row.name, row.sku])).toEqual([
      ['Lens kit', 'LENS-01'],
      ['Studio light', 'LIGHT-02'],
      ['Untracked mic', 'MIC-03'],
    ])
    expect(items.find((row: { sku: string }) => row.sku === 'MIC-03').quantity).toBeNull()
    expect(await db.inventory.count({ where: { importBatchId: imp.id } })).toBe(2)
  })

  it('skips matched SKUs when onMatch is skip', async () => {
    const { base, imports } = await setup()
    await call(testUserId, 'POST', `${base}/inventory`, { name: 'Keep me', sku: 'KEEP-1', price: 10, quantity: 1 })
    const preview = await call(carolId, 'POST', imports, {
      source: { kind: 'csv', csv: 'Name,SKU,Price\nChanged,KEEP-1,99\nNew thing,NEW-1,5', filename: 'a.csv' },
    })
    const id = preview.json().data.id
    await call(carolId, 'POST', `${imports}/${id}/commit`)
    const kept = (await call(testUserId, 'GET', `${base}/inventory?q=KEEP-1`)).json().data[0]
    expect(kept).toMatchObject({ name: 'Keep me', price: 10 })
    expect((await call(testUserId, 'GET', `${base}/inventory?q=NEW-1`)).json().data[0].name).toBe('New thing')
  })
})
