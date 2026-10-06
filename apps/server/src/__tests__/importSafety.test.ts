import { describe, it, expect, vi } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId } from './helpers'
import { caller, createWorkspace } from './helpers/workspace'
import { InventoryImportService } from '../services/InventoryImportService'
import * as importState from '../services/importState'

const app = buildTestApp()
const call = caller(app)
async function setup() {
  const ws = await createWorkspace(app)
  return { ws, base: `/workspaces/${ws.id}` }
}
const source = (csv: string) => ({ source: { kind: 'csv', csv, filename: 'records.csv' } })

describe('MVP import safeguards', () => {
  it('reviews shared and conflicting file emails instead of collapsing people', async () => {
    const { base } = await setup()
    const imports = `${base}/contact-imports`
    const csv =
      'Name,Email\nAlice,info@company.test\nBob,info@company.test\nCarol,family@example.test\nDave,family@example.test'
    const preview = await call(testUserId, 'POST', imports, source(csv))
    expect(preview.statusCode).toBe(201)
    const id = preview.json().data.id
    const rows = (await call(testUserId, 'GET', `${imports}/${id}/rows`)).json().data
    expect(rows.map((row: any) => row.proposal)).toEqual(['create', 'review', 'create', 'review'])
    expect((await call(testUserId, 'POST', `${imports}/${id}/commit`, {})).statusCode).toBe(409)
    for (const row of rows.filter((row: any) => row.proposal === 'review')) {
      expect(
        (await call(testUserId, 'PUT', `${imports}/${id}/rows/${row.id}/resolution`, { action: 'create' }))
          .statusCode,
      ).toBe(200)
    }
    expect((await call(testUserId, 'POST', `${imports}/${id}/commit`, {})).statusCode).toBe(200)
    expect(await db.contact.count()).toBe(4)
  })

  it('does not report an inventory import as a previous contact import', async () => {
    const { base } = await setup()
    const body = source('Name\nSame source')
    const inventory = (await call(testUserId, 'POST', `${base}/inventory-imports`, body)).json().data
    expect(
      (await call(testUserId, 'POST', `${base}/inventory-imports/${inventory.id}/commit`, {})).statusCode,
    ).toBe(200)
    const contacts = await call(testUserId, 'POST', `${base}/contact-imports`, body)
    expect(contacts.statusCode).toBe(201)
    expect(contacts.json().data.previousImportId).toBeNull()
  })

  for (const kind of ['contact', 'inventory'] as const) {
    it(`rejects a stale ${kind} cancellation after commit has started`, async () => {
      const { base } = await setup()
      const imports = `${base}/${kind}-imports`
      const preview = (await call(testUserId, 'POST', imports, source('Name\nKeep me'))).json().data
      let reached!: () => void
      let release!: () => void
      const waiting = new Promise<void>((resolve) => {
        reached = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const original = importState.lockPreview
      const spy = vi.spyOn(importState, 'lockPreview').mockImplementation(async (...args) => {
        reached()
        await gate
        return original(...args)
      })
      try {
        const cancel = call(testUserId, 'DELETE', `${imports}/${preview.id}`)
        await waiting
        expect((await call(testUserId, 'POST', `${imports}/${preview.id}/commit`, {})).statusCode).toBe(200)
        release()
        const result = await cancel
        expect(result.statusCode).toBe(409)
        expect(result.json().code).toBe('IMPORT_NOT_PREVIEWED')
        expect((await db.importBatch.findUniqueOrThrow({ where: { id: preview.id } })).status).toBe(
          'completed',
        )
      } finally {
        release()
        spy.mockRestore()
      }
    })
  }

  it('skips inventory edited after preview rather than overwriting it', async () => {
    const { base } = await setup()
    const item = (
      await call(testUserId, 'POST', `${base}/inventory`, { name: 'Lens', sku: 'L1', price: 10 })
    ).json().data
    const preview = (
      await call(testUserId, 'POST', `${base}/inventory-imports`, {
        ...source('Name,SKU,Price\nImported,L1,20'),
        options: { onMatch: 'update' },
      })
    ).json().data
    await db.inventory.update({
      where: { id: item.id },
      data: { price: 30, version: { increment: 1 }, updatedAt: new Date(Date.now() + 1000) },
    })
    const result = await call(testUserId, 'POST', `${base}/inventory-imports/${preview.id}/commit`, {})
    expect(result.statusCode).toBe(200)
    expect((await db.inventory.findUniqueOrThrow({ where: { id: item.id } })).price).toBe(30)
    expect((await db.importRow.findFirstOrThrow({ where: { batchId: preview.id } })).outcomeNote).toBe(
      'ITEM_CHANGED',
    )
  })

  it('retains completed chunk progress and resumes only remaining inventory rows', async () => {
    const { base } = await setup()
    const csv = 'Name,SKU\n' + Array.from({ length: 101 }, (_, i) => `Item ${i},SKU-${i}`).join('\n')
    const preview = (await call(testUserId, 'POST', `${base}/inventory-imports`, source(csv))).json().data
    const original = (InventoryImportService.prototype as any).apply
    const spy = vi.spyOn(InventoryImportService.prototype as any, 'apply').mockImplementation(async function (
      this: unknown,
      ...args: any[]
    ) {
      if (args[4].rowNumber === 101) throw new Error('Interrupted chunk')
      return original.apply(this, args)
    })
    try {
      expect(
        (await call(testUserId, 'POST', `${base}/inventory-imports/${preview.id}/commit`, {})).statusCode,
      ).toBe(500)
    } finally {
      spy.mockRestore()
    }
    const partial = (await call(testUserId, 'GET', `${base}/inventory-imports/${preview.id}`)).json().data
    expect(partial).toMatchObject({ status: 'committing', counts: { created: 100 } })
    expect(
      (await call(testUserId, 'POST', `${base}/inventory-imports/${preview.id}/commit`, {})).json().data,
    ).toMatchObject({ status: 'completed', counts: { created: 101 } })
    expect(await db.inventory.count()).toBe(101)
  })
})
