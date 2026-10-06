// doc/13 §12, A1 — query → spreadsheet. A whitelisted query (preset or model-filled,
// validated either way) → a native grid with server-stored rows; numbers by code; a
// recipe in provenance that detects changed data; Regenerate makes a new document
// beside the old one; the channel shows the query before it runs.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId, seedBotUser, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, join, memberId, seedPeople } from './helpers/workspace'
import { startWorkspaceHost } from '../services/WorkspaceHost'
import { setAssistantProvider, type AssistantProvider, type SheetPlan, type SheetPlanInput } from '../bots/assistant/provider'
import { resetAssistantCaps } from '../bots/assistant/calls'
import { addDays, validateSheetQuery } from '../services/sheetQuery'

const app = buildTestApp()
const call = caller(app)
let host: ReturnType<typeof startWorkspaceHost>
beforeAll(() => { host = startWorkspaceHost() })
afterAll(() => host.stop())
let bot: { userId: string; botId: string }
beforeEach(async () => {
  bot = await seedBotUser({ handle: 'chatbot', name: 'chatbot' })
  await seedPeople()
  resetAssistantCaps()
})
afterEach(() => setAssistantProvider(undefined))

const today = () => new Date().toISOString().slice(0, 10) // workspaces default to UTC
const noon = (day: string) => new Date(`${day}T12:00:00Z`)
const sunday = () => addDays(today(), (7 - new Date(`${today()}T12:00:00Z`).getUTCDay()) % 7)

async function workspace() {
  const ws = await createWorkspace(app)
  await host.idle()
  const { roomId } = await db.workspaceChannel.findUniqueOrThrow({ where: { workspaceId: ws.id } })
  return { ws, roomId, base: `/workspaces/${ws.id}` }
}
async function contact(ws: string, name: string, data: Record<string, unknown> = {}, company?: string) {
  const [firstName, lastName] = name.split(' ')
  const c = await db.contact.create({ data: { workspaceId: ws, firstName, lastName, displayName: name, ...data } })
  if (company) {
    const a = (await db.account.findFirst({ where: { workspaceId: ws, name: company } })) ?? (await db.account.create({ data: { workspaceId: ws, name: company } }))
    await db.contactAccount.create({ data: { workspaceId: ws, contactId: c.id, accountId: a.id, isPrimary: true } })
  }
  return c
}
const item = (ws: string, name: string, data: Record<string, unknown> = {}) => db.inventory.create({ data: { workspaceId: ws, name, ...data } })
const sheet = (base: string, body: object, who = testUserId) => call(who, 'POST', `${base}/sheets`, { idempotencyKey: `k-${Math.random()}`, ...body })
const rows = async (base: string, id: string, who = testUserId) => (await call(who, 'GET', `${base}/documents/${id}/materialization`)).json().data.table as { columns: { id: string; label: string }[]; rows: { id: string; cells: Record<string, string> }[] }

describe('the sheet query is whitelisted', () => {
  it('refuses unknown fields, columns, groupings, bad dates and mixed filters', () => {
    const bad = [
      { source: 'deals', columns: ['name'] },
      { source: 'contacts' },
      { source: 'contacts', columns: ['name', 'revenue'] },
      { source: 'contacts', columns: ['name'], where: 'x' },
      { source: 'contacts', columns: ['name'], filters: { leadStatus: ['hot'] } },
      { source: 'contacts', columns: ['name'], filters: { followUp: { to: '10/11/2026' } } },
      { source: 'contacts', columns: ['name'], filters: { followUp: { from: '2026-10-09', to: '2026-10-01' } } },
      { source: 'contacts', columns: ['name'], filters: { followUp: { to: '2026-10-09' }, noFollowUp: true } },
      { source: 'contacts', groupBy: 'leadStatus', sort: { field: 'name', direction: 'asc' } },
      { source: 'inventory', columns: ['name'], filters: { stock: 'some' } },
      { source: 'inventory', columns: ['name'], filters: { priceMin: 10, priceMax: 5 } },
      { source: 'inventory', groupBy: 'leadStatus' },
      { source: 'inventory', columns: ['name'], limit: 0 },
    ]
    for (const q of bad) expect(() => validateSheetQuery(q), JSON.stringify(q)).toThrow(expect.objectContaining({ code: 'INVALID_SHEET_QUERY' }))
    expect(validateSheetQuery({ source: 'contacts', groupBy: 'leadStatus', columns: ['name'] })).toEqual({ source: 'contacts', groupBy: 'leadStatus' })
  })
})

describe('presets → sheets', () => {
  it('lists the presets', async () => {
    const { base } = await workspace()
    const res = await call(testUserId, 'GET', `${base}/sheets/presets`)
    expect(res.statusCode).toBe(200)
    await validateResponse('listSheetPresets', 200, res.json())
    expect(res.json().data.map((p: any) => p.key)).toEqual(['follow-ups-week', 'leads-by-stage', 'gone-quiet', 'low-stock', 'stock-by-category', 'price-list'])
  })

  it('"Follow-ups this week": open leads due by Sunday, overdue first, with company and owner', async () => {
    const { ws, base } = await workspace()
    const alice = await memberId(ws.id, testUserId)
    await contact(ws.id, 'Ann Overdue', { nextFollowUp: noon(addDays(today(), -3)), leadStatus: 'contacting', ownerMemberId: alice, primaryEmail: 'ann@x.test' }, 'Brightside Dental')
    await contact(ws.id, 'Ben Sunday', { nextFollowUp: noon(sunday()), leadStatus: 'qualified' })
    await contact(ws.id, 'Cy Nextweek', { nextFollowUp: noon(addDays(sunday(), 1)), leadStatus: 'new' })
    await contact(ws.id, 'Dee Customer', { nextFollowUp: noon(today()), leadStatus: 'customer' })
    await contact(ws.id, 'Eve Archived', { nextFollowUp: noon(today()), status: 'archived' })
    await contact(ws.id, 'Fay Deleted', { nextFollowUp: noon(today()), deletedAt: new Date() })

    const res = await sheet(base, { preset: 'follow-ups-week' })
    expect(res.statusCode).toBe(201)
    await validateResponse('createSheet', 201, res.json())
    const doc = res.json().data
    expect(doc.title).toMatch(/^Follow-ups this week · [A-Z][a-z]{2} \d{1,2}$/)
    expect(doc.descriptor).toEqual({ surface: 'grid', source: { kind: 'native', schemaVersion: 1 } })
    expect(doc.capabilities.readMaterialization).toBe(true)
    expect(doc.workspaceAccess).toBeNull() // a person's own sheet is private
    expect(doc.provenance).toMatchObject({ kind: 'artifact', generator: 'sheet.query', preset: 'follow-ups-week', rowCount: 2, timezone: 'UTC', currency: 'USD', previousId: null })
    expect(doc.provenance.query.filters.followUp).toEqual({ to: sunday() })
    expect(doc.provenance.summary).toBe(`Contacts · lead status New, Contacting, Connected or Qualified · follow-up on or before ${new Date(`${sunday()}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} · columns: Name, Company, Email, Phone, Lead status, Next follow-up, Owner · sorted by next follow-up`)

    const t = await rows(base, doc.id)
    expect(t.columns.map((c) => c.label)).toEqual(['Name', 'Company', 'Email', 'Phone', 'Lead status', 'Next follow-up', 'Owner'])
    expect(t.rows.map((r) => r.cells.name)).toEqual(['Ann Overdue', 'Ben Sunday'])
    expect(t.rows[0]!.cells).toEqual({ name: 'Ann Overdue', company: 'Brightside Dental', email: 'ann@x.test', phone: '', leadStatus: 'Contacting', nextFollowUp: addDays(today(), -3), owner: 'Alice' })
  })

  it('"Leads by stage": every stage counted by code, with a total', async () => {
    const { ws, base } = await workspace()
    for (const [n, s] of [['A A', 'new'], ['B B', 'new'], ['C C', 'qualified'], ['D D', 'lost']] as const) await contact(ws.id, n, { leadStatus: s })
    await contact(ws.id, 'E E', { leadStatus: null })
    const doc = (await sheet(base, { preset: 'leads-by-stage' })).json().data
    const t = await rows(base, doc.id)
    expect(t.rows.map((r) => [r.cells.group, r.cells.contacts])).toEqual([['New', '2'], ['Contacting', '0'], ['Connected', '0'], ['Qualified', '1'], ['Customer', '0'], ['Lost', '1'], ['Not set', '1'], ['Total', '5']])
  })

  it('inventory: low or out of stock; totals by category; stock value computed and sorted by code', async () => {
    const { ws, base } = await workspace()
    await item(ws.id, 'Bolts', { category: 'Hardware', price: 0.25, quantity: 3, lowStockThreshold: 10, lowStock: true })
    await item(ws.id, 'Nuts', { category: 'Hardware', price: 0.1, quantity: 0, lowStockThreshold: 10 })
    await item(ws.id, 'Drill', { category: 'Tools', price: 89.5, quantity: 4, lowStockThreshold: 2 })
    await item(ws.id, 'Install service', { category: 'Services', price: 120, quantity: null })
    await item(ws.id, 'Old saw', { category: 'Tools', price: 20, quantity: 0, status: 'archived' })

    const low = (await sheet(base, { preset: 'low-stock' })).json().data
    expect((await rows(base, low.id)).rows.map((r) => [r.cells.name, r.cells.quantity])).toEqual([['Nuts', '0'], ['Bolts', '3']])

    const byCat = (await sheet(base, { preset: 'stock-by-category' })).json().data
    const t = await rows(base, byCat.id)
    expect(t.columns.map((c) => c.label)).toEqual(['Category', 'Items', 'Units in stock', 'Stock value (USD)'])
    expect(t.rows.map((r) => Object.values(r.cells))).toEqual([['Hardware', '2', '3', '0.75'], ['Services', '1', '0', '0.00'], ['Tools', '1', '4', '358.00'], ['Total', '4', '7', '358.75']])

    const top = (await sheet(base, { query: { source: 'inventory', columns: ['name', 'price', 'quantity', 'stockValue'], sort: { field: 'stockValue', direction: 'desc' }, limit: 2 }, title: 'Top stock' })).json().data
    expect(top.title).toBe('Top stock')
    expect((await rows(base, top.id)).rows.map((r) => [r.cells.name, r.cells.stockValue])).toEqual([['Drill', '358.00'], ['Bolts', '0.75']])
  })

  it('is retry-safe, private to its maker, and refuses non-members and bad requests', async () => {
    const { ws, base } = await workspace()
    await contact(ws.id, 'A A', { leadStatus: 'new' })
    const first = await sheet(base, { preset: 'leads-by-stage', idempotencyKey: 'same' })
    const again = await sheet(base, { preset: 'leads-by-stage', idempotencyKey: 'same' })
    expect(again.json().data.id).toBe(first.json().data.id)
    expect(await db.document.count({ where: { workspaceId: ws.id } })).toBe(1)

    await join(app, ws.id, carolId, 'carol@test.local')
    expect((await call(carolId, 'GET', `${base}/documents/${first.json().data.id}`)).statusCode).toBe(404)
    expect((await sheet(base, { preset: 'leads-by-stage' }, 'ws-test-dave')).statusCode).toBe(404)
    expect((await sheet(base, { preset: 'nope' })).json().code).toBe('UNKNOWN_SHEET_PRESET')
    expect((await sheet(base, { preset: 'leads-by-stage', query: { source: 'contacts', groupBy: 'leadStatus' } })).json().code).toBe('INVALID_SHEET_REQUEST')
    expect((await sheet(base, { query: { source: 'contacts', columns: ['salary'] } })).json().code).toBe('INVALID_SHEET_QUERY')
    expect((await call(testUserId, 'POST', `${base}/sheets/describe`, { query: { source: 'inventory', columns: ['name', 'price'], filters: { stock: 'out' } } })).json().data.summary).toBe('Inventory · out of stock · columns: Name, Price')
  })
})

describe('recipe, stale check and Regenerate', () => {
  it('detects changed data; regenerating makes a related new document and leaves the old one alone', async () => {
    const { ws, base } = await workspace()
    const ann = await contact(ws.id, 'Ann A', { leadStatus: 'new' })
    const doc = (await sheet(base, { query: { source: 'contacts', columns: ['name', 'leadStatus'] }, title: 'All contacts' })).json().data
    const fresh = await call(testUserId, 'GET', `${base}/documents/${doc.id}/recipe`)
    expect(fresh.statusCode).toBe(200)
    await validateResponse('getDocumentRecipe', 200, fresh.json())
    expect(fresh.json().data).toMatchObject({ stale: false, dataChanged: false, periodMoved: false, currentRowCount: 1 })

    await db.contact.update({ where: { id: ann.id }, data: { leadStatus: 'qualified' } })
    await contact(ws.id, 'Bea B', { leadStatus: 'new' })
    expect((await call(testUserId, 'GET', `${base}/documents/${doc.id}/recipe`)).json().data).toMatchObject({ stale: true, dataChanged: true, currentRowCount: 2 })

    const res = await call(testUserId, 'POST', `${base}/documents/${doc.id}/regenerate`, { idempotencyKey: 'regen-1' })
    expect(res.statusCode).toBe(201)
    const next = res.json().data
    expect(next.id).not.toBe(doc.id)
    expect(next.title).toMatch(/^All contacts · [A-Z][a-z]{2} \d{1,2}$/)
    expect(next.provenance.previousId).toBe(doc.id)
    expect((await rows(base, next.id)).rows.map((r) => r.cells.leadStatus).sort()).toEqual(['New', 'Qualified'])
    expect((await rows(base, doc.id)).rows.map((r) => r.cells.leadStatus)).toEqual(['New']) // the old sheet is untouched
    expect((await call(testUserId, 'GET', `${base}/documents/${doc.id}/related`)).json().data.map((r: any) => r.document.id)).toEqual([next.id])
    expect((await call(testUserId, 'GET', `${base}/documents/${next.id}/recipe`)).json().data.stale).toBe(false)

    const plain = (await call(testUserId, 'POST', `${base}/documents`, { title: 'Notes', descriptor: { surface: 'blocks', source: { kind: 'native', schemaVersion: 1 } }, idempotencyKey: 'p1' })).json().data
    expect((await call(testUserId, 'GET', `${base}/documents/${plain.id}/recipe`)).statusCode).toBe(404)
  })
})

class Planner implements AssistantProvider {
  readonly name = 'fake'
  readonly model = 'fake-1'
  inputs: SheetPlanInput[] = []
  constructor(private make: (i: SheetPlanInput) => any) {}
  async extract(): Promise<never> { throw new Error('unused') }
  async draft(): Promise<never> { throw new Error('unused') }
  async planSheet(input: SheetPlanInput) { this.inputs.push(input); return { plan: this.make(input) as SheetPlan, usage: { promptTokens: 400, completionTokens: 80 } } }
}
const modelQuery = (over: Record<string, unknown> = {}) => ({
  supported: true, reason: null, title: 'Open leads with no follow-up',
  query: { source: 'contacts', columns: ['name', 'email', 'leadStatus'], groupBy: null, contactFilters: { leadStatus: ['new', 'contacting'], followUpFrom: null, followUpTo: null, noFollowUp: true, quietSince: null, q: null }, inventoryFilters: null, sort: { field: 'name', direction: 'asc' }, limit: null, ...over },
})

describe('the channel', () => {
  const said = async (roomId: string) => (await db.item.findMany({ where: { roomId, message: { authorId: bot.userId } }, include: { message: true }, orderBy: { number: 'asc' } })).at(-1)!
  const say = async (roomId: string, text: string) => { expect((await call(testUserId, 'POST', `/rooms/${roomId}/items`, { text, chat: true })).statusCode).toBe(201); await host.idle() }
  const choose = async (itemId: string, option: string) => { expect((await call(testUserId, 'POST', `/items/${itemId}/choice`, { optionIds: [option] })).statusCode).toBe(200); await host.idle() }

  it('AI off: "sheet" offers the presets; a pick makes a workspace-visible sheet and links it', async () => {
    setAssistantProvider(null)
    const { ws, roomId, base } = await workspace()
    await contact(ws.id, 'A A', { leadStatus: 'new' })
    await join(app, ws.id, carolId, 'carol@test.local')
    await say(roomId, 'sheet')
    const offer = await said(roomId)
    expect(offer.message.text).toBe('Which sheet? Each one reads your current records.')
    expect((offer.message.actions as any).options.map((o: any) => o.label)).toEqual(['Follow-ups this week', 'Leads by stage', 'Gone quiet', 'Low or out of stock', 'Stock by category', 'Price list'])
    await choose(offer.id, 'leads-by-stage')
    const done = await said(roomId)
    expect(done.message.text).toMatch(/^Made “Leads by stage · [A-Z][a-z]{2} \d{1,2}”: 6 groups\. /)
    const link = (done.message.links as any[])[0]
    expect(link).toMatchObject({ type: 'document', workspaceId: ws.id })
    const doc = await db.document.findUniqueOrThrow({ where: { id: link.id } })
    expect(doc.workspaceAccess).toBe('viewer')
    expect((await call(carolId, 'GET', `${base}/documents/${doc.id}`)).statusCode).toBe(200)

    await say(roomId, 'sheet: contacts with no email')
    expect((await said(roomId)).message.text).toBe('I can make these sheets now. Pick one:')
    await say(roomId, 'sheets are great') // not a request
    expect((await said(roomId)).message.text).toBe('I can make these sheets now. Pick one:')
  })

  it('"sheet: …": the model fills the query, the person sees it, then [Make the sheet]', async () => {
    const planner = new Planner(() => modelQuery())
    setAssistantProvider(planner)
    const { ws, roomId } = await workspace()
    await item(ws.id, 'Drill', { category: 'Tools' })
    await contact(ws.id, 'Ann A', { leadStatus: 'new', primaryEmail: 'ann@x.test' })
    await contact(ws.id, 'Ben B', { leadStatus: 'contacting', nextFollowUp: noon(today()) })
    await say(roomId, 'sheet: open leads with no follow-up')
    expect(planner.inputs[0]).toMatchObject({ request: 'open leads with no follow-up', today: today(), categories: ['Tools'] })
    const confirm = await said(roomId)
    expect(confirm.message.text).toBe('I’d make this sheet: Contacts · lead status New or Contacting · no follow-up set · columns: Name, Email, Lead status · sorted by name.')
    expect(await db.document.count({ where: { workspaceId: ws.id } })).toBe(0) // nothing runs before the button
    await choose(confirm.id, 'make')
    const done = await said(roomId)
    expect(done.message.text).toMatch(/^Made “Open leads with no follow-up”: 1 contact\. /)
    const doc = await db.document.findUniqueOrThrow({ where: { id: (done.message.links as any[])[0].id } })
    expect((doc.payload as any).rows.map((r: any) => r.cells.name)).toEqual(['Ann A'])
    expect(await db.assistantCall.count({ where: { workspaceId: ws.id } })).toBe(1)

    await say(roomId, 'sheet: open leads with no follow-up')
    await choose((await said(roomId)).id, 'cancel')
    expect((await said(roomId)).message.text).toBe('Cancelled. Nothing was made.')
    expect(await db.document.count({ where: { workspaceId: ws.id } })).toBe(1)
  })

  it('unsupported, invalid and empty requests are said plainly; nothing is made', async () => {
    let next: any = { supported: false, reason: 'There is no deals data yet.', title: null, query: null }
    setAssistantProvider(new Planner(() => next))
    const { ws, roomId } = await workspace()
    await say(roomId, 'sheet: deals closing this month')
    expect((await said(roomId)).message.text).toBe('I can’t make that sheet: There is no deals data yet. I can read Contacts and Inventory. These are ready:')

    next = modelQuery({ columns: ['name', 'salary'] })
    await say(roomId, 'sheet: everyone’s salary')
    expect((await said(roomId)).message.text).toBe('I couldn’t turn that into a sheet I can build from Contacts or Inventory. These are ready:')

    next = modelQuery()
    await say(roomId, 'sheet: open leads with no follow-up')
    await choose((await said(roomId)).id, 'make')
    expect((await said(roomId)).message.text).toBe('No contacts match that right now, so I made no sheet.')
    expect(await db.document.count({ where: { workspaceId: ws.id } })).toBe(0)
  })
})
