import { describe, expect, it } from 'vitest'
import { buildTestApp, testUserId, validateResponse } from './helpers'
import { caller, createWorkspace } from './helpers/workspace'

const app = buildTestApp()
const call = caller(app)

describe('company insights and vocabulary', () => {
  it('returns insight cards, seeds pipeline, and supports vocabulary edits', async () => {
    const ws = await createWorkspace(app, testUserId, { name: 'Insights Co' })
    const base = `/workspaces/${ws.id}`

    expect((await call(testUserId, 'POST', `${base}/contacts`, {
      displayName: 'Ada',
      leadStatus: 'new',
      potentialValue: 1200,
      nextFollowUp: new Date(Date.now() - 86400000).toISOString(),
    })).statusCode).toBe(201)

    expect((await call(testUserId, 'POST', `${base}/inventory`, {
      name: 'Widget',
      price: 10,
      quantity: 1,
      lowStockThreshold: 5,
      category: 'Tools',
    })).statusCode).toBe(201)

    const insights = await call(testUserId, 'GET', `${base}/insights`)
    expect(insights.statusCode).toBe(200)
    await validateResponse('getWorkspaceInsights', 200, insights.json())
    const data = insights.json().data
    expect(data.cards.some((c: { id: string }) => c.id === 'open-leads')).toBe(true)
    expect(data.pipeline.length).toBeGreaterThanOrEqual(6)
    expect(data.attention.length).toBeGreaterThan(0)

    const vocab = await call(testUserId, 'GET', `${base}/vocabulary`)
    expect(vocab.statusCode).toBe(200)
    await validateResponse('getWorkspaceVocabulary', 200, vocab.json())
    expect(vocab.json().data.categories).toEqual(expect.arrayContaining(['Tools', 'Products', 'Services']))
    expect(vocab.json().data.stages.some((s: { key: string }) => s.key === 'new')).toBe(true)
    const tags = await call(testUserId, 'GET', `${base}/tags`)
    expect(tags.statusCode).toBe(200)
    expect(tags.json().data.map((t: { name: string }) => t.name)).toEqual(
      expect.arrayContaining(['Prospect', 'Customer', 'Partner', 'Vendor']),
    )

    const stages = vocab.json().data.stages.filter((s: { archived: boolean }) => !s.archived)
    const renamed = stages.map((s: { id: string; key: string; label: string; kind: string; archived: boolean }, i: number) =>
      s.key === 'new'
        ? { id: s.id, key: s.key, label: 'Fresh', position: i, kind: s.kind, archived: s.archived }
        : { id: s.id, key: s.key, label: s.label, position: i, kind: s.kind, archived: s.archived },
    )
    const put = await call(testUserId, 'PUT', `${base}/pipeline`, { stages: renamed })
    expect(put.statusCode).toBe(200)
    await validateResponse('updateWorkspacePipeline', 200, put.json())
    expect(put.json().data.find((s: { key: string }) => s.key === 'new').label).toBe('Fresh')

    expect((await call(testUserId, 'PATCH', `${base}/vocabulary/categories`, { from: 'Tools', to: 'Gear' })).statusCode).toBe(200)
    expect((await call(testUserId, 'GET', `${base}/vocabulary`)).json().data.categories).toContain('Gear')

    expect((await call(testUserId, 'POST', `${base}/vocabulary/categories`, { name: 'Spare' })).statusCode).toBe(201)
    expect((await call(testUserId, 'GET', `${base}/vocabulary`)).json().data.categories).toEqual(expect.arrayContaining(['Gear', 'Spare']))
    expect((await call(testUserId, 'DELETE', `${base}/vocabulary/categories`, { name: 'Spare' })).statusCode).toBe(200)
    expect((await call(testUserId, 'GET', `${base}/vocabulary`)).json().data.categories).not.toContain('Spare')
  })
})
