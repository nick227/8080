// doc/13 §12, A3 — a monthly marketing budget. Four inputs with four owners (profile or
// typed business, typed amount parsed by code, goal button, priority buttons); code owns
// the channels, split, rounding, amounts, totals and the sheet; the model writes only
// per-channel notes, sees no numbers, and its notes with numbers are dropped.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { db } from '@project/db'
import { sheetTotals } from '@project/shared'
import { buildTestApp, testUserId, seedBotUser, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, join, seedPeople } from './helpers/workspace'
import { startWorkspaceHost } from '../services/WorkspaceHost'
import { setAssistantProvider, type AssistantProvider, type BudgetNotesInput } from '../bots/assistant/provider'
import { resetAssistantCaps } from '../bots/assistant/calls'
import { CHANNELS, GOALS, allocate } from '../services/marketingBudget'
import { amountIn, budgetRequest } from '../bots/flows/requests'

const app = buildTestApp()
const call = caller(app)
let host: ReturnType<typeof startWorkspaceHost>
beforeAll(() => { host = startWorkspaceHost() })
afterAll(() => host.stop())
let bot: { userId: string; botId: string }
beforeEach(async () => { bot = await seedBotUser({ handle: 'chatbot', name: 'chatbot' }); await seedPeople(); resetAssistantCaps() })
afterEach(() => setAssistantProvider(undefined))

async function workspace() {
  const ws = await createWorkspace(app)
  await host.idle()
  const { roomId } = await db.workspaceChannel.findUniqueOrThrow({ where: { workspaceId: ws.id } })
  return { ws, roomId, base: `/workspaces/${ws.id}` }
}
const budget = (base: string, body: object, who = testUserId) => call(who, 'POST', `${base}/budgets`, { idempotencyKey: `b-${Math.random()}`, ...body })
const content = async (base: string, id: string) => (await call(testUserId, 'GET', `${base}/documents/${id}/content`)).json().data.content

class Notes implements AssistantProvider {
  readonly name = 'fake'
  readonly model = 'fake-1'
  inputs: BudgetNotesInput[] = []
  constructor(private make: (i: BudgetNotesInput) => any) {}
  async extract(): Promise<never> { throw new Error('unused') }
  async draft(): Promise<never> { throw new Error('unused') }
  async budgetNotes(input: BudgetNotesInput) { this.inputs.push(input); return { notes: this.make(input), usage: { promptTokens: 200, completionTokens: 120 } } }
}

describe('the split is code', () => {
  it('whole percents summing to 100 and amounts summing exactly to the budget, for every goal and priority mix', () => {
    for (const goal of GOALS) {
      for (const priorities of [[], ['email'], ['search', 'local'], ['events', 'referral', 'content']] as const) {
        for (const minor of [1, 99, 100_00, 1_234_567, 12_000_00]) {
          const rows = allocate(goal, [...priorities], minor)
          expect(rows.reduce((s, r) => s + r.percent, 0)).toBe(100)
          expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(minor)
          expect(rows.every((r) => Number.isInteger(r.percent) && Number.isInteger(r.amount) && r.percent > 0)).toBe(true)
        }
      }
    }
  })
  it('a priority gets more than it would without being one', () => {
    const plain = allocate('leads', [], 100_000).find((r) => r.channel === 'email')!.percent
    expect(allocate('leads', ['email'], 100_000).find((r) => r.channel === 'email')!.percent).toBe(plain + 10)
    expect(allocate('sales', [], 100_000).some((r) => r.channel === 'events')).toBe(false) // 0% rows are left out
  })
})

describe('POST /budgets', () => {
  it('AI off: a typed sheet — share and per-month totals computed, template notes, inputs and their sources recorded', async () => {
    setAssistantProvider(null)
    const { base } = await workspace()
    const res = await budget(base, { monthlyBudgetMinor: 1_200_000, goal: 'leads', priorities: ['search', 'local'], businessType: 'commercial photography' })
    expect(res.statusCode).toBe(201)
    await validateResponse('createMarketingBudget', 201, res.json())
    const doc = res.json().data
    expect(doc.title).toBe('Monthly Marketing Budget')
    expect(doc.workspaceAccess).toBeNull()
    expect(doc.provenance).toMatchObject({
      kind: 'artifact', generator: 'budget.monthly', currency: 'USD',
      inputs: { businessType: 'commercial photography', monthlyMinor: 1_200_000, goal: 'leads', priorities: ['search', 'local'] },
      sources: { businessType: 'typed', notes: 'template', callId: null },
      summary: 'Planning template · $12,000.00 a month · for commercial photography · goal: Leads · priorities: Paid search and Local and print',
    })
    const c = await content(base, doc.id)
    expect(c.columns.map((x: any) => [x.label, x.type, x.total ?? null])).toEqual([['Channel', 'text', null], ['Share (%)', 'number', 'sum'], ['Per month', 'money', 'sum'], ['What it pays for', 'text', null]])
    expect(sheetTotals(c)).toEqual({ share: 100, monthly: 1_200_000 })
    expect(c.rows.find((r: any) => r.id === 'search').cells).toEqual({ channel: 'Paid search', share: 45, monthly: 540_000, notes: 'Ads shown to people already searching for what you offer.' })
    const recipe = (await call(testUserId, 'GET', `${base}/documents/${doc.id}/recipe`)).json().data
    expect(recipe).toMatchObject({ stale: false, dataChanged: false })
  })

  it('the business type comes from the company profile when not given', async () => {
    setAssistantProvider(null)
    const { ws, base } = await workspace()
    await db.companyProfile.create({ data: { workspaceId: ws.id, revision: 1, purpose: 'Wedding and event photography' } })
    const doc = (await budget(base, { monthlyBudgetMinor: 250_000, goal: 'awareness' })).json().data
    expect(doc.provenance.inputs.businessType).toBe('Wedding and event photography')
    expect(doc.provenance.sources.businessType).toBe('profile')
  })

  it('refuses inputs outside the fixed lists; private to its maker; 404 to non-members', async () => {
    const { ws, base } = await workspace()
    expect((await budget(base, { monthlyBudgetMinor: 100, goal: 'growth' })).statusCode).toBe(400)
    expect((await budget(base, { monthlyBudgetMinor: 100, goal: 'leads', priorities: ['tv'] })).statusCode).toBe(400)
    expect((await budget(base, { monthlyBudgetMinor: 100, goal: 'leads', priorities: ['search', 'email', 'local', 'events'] })).statusCode).toBe(400)
    expect((await budget(base, { monthlyBudgetMinor: 0, goal: 'leads' })).statusCode).toBe(400)
    expect((await budget(base, { monthlyBudgetMinor: 12.5, goal: 'leads' })).statusCode).toBe(400)
    const doc = (await budget(base, { monthlyBudgetMinor: 100_00, goal: 'leads' })).json().data
    await join(app, ws.id, carolId, 'carol@test.local')
    expect((await call(carolId, 'GET', `${base}/documents/${doc.id}`)).statusCode).toBe(404)
    expect((await budget(base, { monthlyBudgetMinor: 100, goal: 'leads' }, 'ws-test-dave')).statusCode).toBe(404)
  })

  it('the model sees no numbers and writes only notes; notes with numbers or unknown channels are dropped', async () => {
    const fake = new Notes((i) => ({ notes: [
      ...i.channels.map((c) => ({ channel: c.key, text: `Spend on ${c.label.toLowerCase()} for photo clients` })),
      { channel: 'email', text: 'Send 4 newsletters a month' },   // a duplicate with a number: dropped
      { channel: 'tv', text: 'Run TV ads' },                        // not a channel: dropped
    ] }))
    setAssistantProvider(fake)
    const { ws, base } = await workspace()
    const doc = (await budget(base, { monthlyBudgetMinor: 1_200_000, goal: 'leads', priorities: ['search'], businessType: 'commercial photography' })).json().data
    const sent = JSON.stringify(fake.inputs[0])
    expect(sent).not.toMatch(/\d/) // no amount, share or id reaches the model
    expect(Object.keys(fake.inputs[0]!)).toEqual(['businessType', 'goal', 'priorities', 'channels'])
    const c = await content(base, doc.id)
    expect(c.rows.find((r: any) => r.id === 'email').cells.notes).toBe('Spend on email for photo clients.')
    expect(doc.provenance.sources).toMatchObject({ notes: 'ai' })
    expect(sheetTotals(c).monthly).toBe(1_200_000) // the model never touched an amount
    expect(await db.assistantCall.count({ where: { workspaceId: ws.id } })).toBe(1)
  })
})

describe('reading the request is code', () => {
  it('amounts, goals and channels from a plain sentence', () => {
    expect(budgetRequest('Create a monthly marketing budget for $2,500.', 'USD')).toEqual({ monthlyMinor: 250_000, goal: null, priorities: [] })
    expect(budgetRequest('make a marketing budget of 2.5k to get more leads from google ads and email', 'USD')).toEqual({ monthlyMinor: 250_000, goal: 'leads', priorities: ['search', 'email'] })
    expect(budgetRequest('budget', 'USD')).toEqual({ monthlyMinor: null, goal: null, priorities: [] })
    expect(budgetRequest('Create a marketing budget for our launch, 1200 USD a month', 'USD')?.monthlyMinor).toBe(120_000)
    expect(budgetRequest('Create a marketing budget for 3 months', 'USD')?.monthlyMinor).toBeNull() // "3 months" is no amount
    expect(budgetRequest('our budget is tight', 'USD')).toBeNull()
    expect(amountIn('for 12.345', 'USD')).toBeNull() // no fractions of a cent
  })
})

describe('the channel', () => {
  const said = async (roomId: string) => (await db.item.findMany({ where: { roomId, message: { authorId: bot.userId } }, include: { message: true }, orderBy: { number: 'asc' } })).at(-1)!
  const say = async (roomId: string, text: string) => { expect((await call(testUserId, 'POST', `/rooms/${roomId}/items`, { text, chat: true })).statusCode).toBe(201); await host.idle() }

  it('"Create a monthly marketing budget for $2,500" → the sheet in Documents and a link; no questions', async () => {
    setAssistantProvider(null)
    const { ws, roomId, base } = await workspace()
    await db.companyProfile.create({ data: { workspaceId: ws.id, revision: 1, purpose: 'Commercial photography for local businesses' } })
    await say(roomId, 'Create a monthly marketing budget for $2,500.')
    const done = await said(roomId)
    expect(done.message.text).toBe('Created “Monthly Marketing Budget” in Documents: $2,500.00 a month across 7 channels. It is a planning template using a standard split; it does not use sales or spending data.')
    expect(done.message.actions).toBeNull()
    const doc = await db.document.findUniqueOrThrow({ where: { id: (done.message.links as any[])[0].id } })
    expect(doc.workspaceAccess).toBe('viewer')
    expect(doc.provenance).toMatchObject({ inputs: { businessType: 'Commercial photography for local businesses', goal: 'general', priorities: [] }, sources: { businessType: 'profile' } })
    expect(sheetTotals(await content(base, doc.id))).toEqual({ share: 100, monthly: 250_000 })
    expect((await call(testUserId, 'GET', `${base}/documents`)).json().data.map((d: any) => d.title)).toContain('Monthly Marketing Budget')
  })

  it('only a missing amount is asked; goal and channel words are read from the request', async () => {
    setAssistantProvider(null)
    const { ws, roomId } = await workspace()
    await say(roomId, 'Create a marketing budget to get more leads, mostly paid search and email')
    expect((await said(roomId)).message.text).toBe('What is the monthly budget, in USD?')
    await say(roomId, 'about a lot')
    expect((await said(roomId)).message.text).toBe('“about a lot” isn’t an amount. Type the monthly budget as a number, for example 2,500.')
    await say(roomId, '1,200')
    const done = await said(roomId)
    expect(done.message.text).toBe('Created “Monthly Marketing Budget” in Documents: $1,200.00 a month across 7 channels. It is a planning template using a standard split for leads; it does not use sales or spending data.')
    const doc = await db.document.findFirstOrThrow({ where: { workspaceId: ws.id } })
    expect(doc.provenance).toMatchObject({ inputs: { goal: 'leads', priorities: ['search', 'email'], monthlyMinor: 120_000, businessType: null }, sources: { businessType: 'none' } })
    await say(roomId, '500') // the request is done: a bare number is just a message now
    expect(await db.document.count({ where: { workspaceId: ws.id } })).toBe(1)
    expect(CHANNELS).toHaveLength(7)
  })
})
