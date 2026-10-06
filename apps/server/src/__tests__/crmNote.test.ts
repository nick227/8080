// doc/13 D2 — a messy note → one proposed CRM change. Rules §10: verbatim note, match
// before create, ambiguity = a choice, model proposes / server decides, no silent
// replacement, one coherent operation, no aggressive inference, atomic, same lifecycle.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId, seedBotUser, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, join, seedPeople } from './helpers/workspace'
import { startWorkspaceHost } from '../services/WorkspaceHost'
import { setAssistantProvider, type AssistantProvider, type NoteReading } from '../bots/assistant/provider'
import { resetAssistantCaps } from '../bots/assistant/calls'
import { applyPlan, planNote, type NotePlan } from '../services/crmNote'
import { ground } from '../bots/assistant/grounding'

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

const NOTE = 'Met Sarah Lee from Brightside Dental. They want a new website early Q1, budget around $8k. She asked me to call Friday.'
const READ: NoteReading = {
  person: { firstName: 'Sarah', lastName: 'Lee', title: null, email: null, phone: null },
  company: { name: 'Brightside Dental', domain: null },
  followUp: { date: '', quote: 'call Friday' },
  facts: [
    { key: 'need', value: 'A new website', quote: 'want a new website' },
    { key: 'timing', value: 'Early Q1', quote: 'early Q1' },
    { key: 'budget', value: 'About $8,000', quote: 'budget around $8k' },
  ],
}
const friday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7 || 7)); return d.toISOString().slice(0, 10) }

class Reader implements AssistantProvider {
  readonly name = 'fake'
  readonly model = 'fake-1'
  reads: string[] = []
  constructor(private reading: (note: string) => NoteReading = () => ({ ...READ, followUp: { date: friday(), quote: 'call Friday' } })) {}
  async extract(): Promise<never> { throw new Error('unused') }
  async draft(): Promise<never> { throw new Error('unused') }
  async readNote(input: { note: string }) { this.reads.push(input.note); return { reading: this.reading(input.note), usage: { promptTokens: 200, completionTokens: 60 } } }
}

async function workspace() {
  const ws = await createWorkspace(app)
  await host.idle()
  const { roomId } = await db.workspaceChannel.findUniqueOrThrow({ where: { workspaceId: ws.id } })
  return { ws, roomId, base: `/workspaces/${ws.id}` }
}
const addNote = (base: string, body: object, who = testUserId) => call(who, 'POST', `${base}/crm/notes`, body)
const act = (base: string, id: string, action: string, who = testUserId) => call(who, 'POST', `${base}/proposals/${id}/${action}`)
async function seedContact(ws: string, name: [string, string], extra: { title?: string; account?: string; leadStatus?: 'qualified' } = {}) {
  const c = await db.contact.create({ data: { workspaceId: ws, firstName: name[0], lastName: name[1], displayName: name.join(' '), title: extra.title, leadStatus: extra.leadStatus } })
  if (extra.account) {
    const a = (await db.account.findFirst({ where: { workspaceId: ws, name: extra.account } })) ?? (await db.account.create({ data: { workspaceId: ws, name: extra.account } }))
    await db.contactAccount.create({ data: { workspaceId: ws, contactId: c.id, accountId: a.id, isPrimary: true } })
  }
  return c
}

describe('a new person and company → one card → one atomic apply', () => {
  it('reads, grounds, plans one coherent change; Apply creates account + contact + link + verbatim note', async () => {
    setAssistantProvider(new Reader())
    const { ws, base } = await workspace()
    const res = await addNote(base, { text: NOTE })
    expect(res.statusCode).toBe(201)
    await validateResponse('addCrmNote', 201, res.json())
    const p = res.json().data.proposal
    expect(p).toMatchObject({ kind: 'crm.note', targetType: 'contact', targetId: 'new', status: 'pending', title: 'Add Sarah Lee to CRM', editable: true, revertible: false })
    expect(p.diff.map((r: any) => [r.label, r.after, r.quote ?? null])).toEqual([
      ['Name', 'Sarah Lee', 'Sarah Lee'],
      ['Company', 'Brightside Dental (new)', 'Brightside Dental'],
      ['Follow up', expect.stringMatching(/^Fri, /), 'call Friday'],
      ['Need', 'A new website', 'want a new website'],
      ['Timing', 'Early Q1', 'early Q1'],
      ['Budget', 'About $8,000', 'budget around $8k'],
      ['Note', NOTE, null],
    ])
    // Nothing written until Apply.
    expect(await db.contact.count({ where: { workspaceId: ws.id } })).toBe(0)

    const applied = await act(base, p.id, 'apply')
    expect(applied.statusCode).toBe(200)
    const contact = await db.contact.findFirstOrThrow({ where: { workspaceId: ws.id }, include: { accounts: { include: { account: true } } } })
    expect(contact).toMatchObject({ displayName: 'Sarah Lee', firstName: 'Sarah', lastName: 'Lee', leadStatus: 'new', origin: 'conversation' })
    expect(contact.nextFollowUp!.toISOString().slice(0, 10)).toBe(friday())
    expect(contact.accounts.map((a) => [a.account.name, a.isPrimary])).toEqual([['Brightside Dental', true]])
    const note = await db.note.findFirstOrThrow({ where: { workspaceId: ws.id }, include: { message: true, links: true } })
    expect(note.message.text).toBe(NOTE) // verbatim (rule 1)
    expect(note.facts).toEqual(READ.facts)
    expect(note.links.map((l) => (l.contactId ? 'contact' : 'account')).sort()).toEqual(['account', 'contact'])
    // One action, the usual timeline entries.
    expect((await db.actionExecution.findMany({ where: { workspaceId: ws.id, action: { startsWith: 'crm.note' } } })).map((e) => [e.action, e.origin])).toEqual([['crm.note.apply', 'api']])
    expect((await db.activity.findMany({ where: { workspaceId: ws.id }, orderBy: { occurredAt: 'asc' } })).map((a) => a.type).filter((t) => t !== 'workspace.created')).toEqual(['account.created', 'contact.created', 'note.added'])
    // The proposal now belongs to the record it made.
    expect((await call(testUserId, 'GET', `${base}/proposals/${p.id}`)).json().data).toMatchObject({ status: 'applied', targetId: contact.id })
  })

  it('apply is atomic: if any step fails, nothing it already wrote stays', async () => {
    const { ws } = await workspace()
    const sarah = await seedContact(ws.id, ['Sarah', 'Lee'])
    const plan: NotePlan = { note: NOTE, reading: null, contact: { id: sarah.id, name: 'Sarah Lee' }, account: { create: { name: 'Brightside Dental', domain: null } }, set: {}, addPoints: [], facts: [], quotes: {} }
    const user = await db.user.findUniqueOrThrow({ where: { id: testUserId }, include: { profile: true } })
    // Wrong base version: the account is created first, then the contact claim fails.
    await expect(applyPlan({ user, origin: 'api' }, ws.id, plan, sarah.version + 5)).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.account.count({ where: { workspaceId: ws.id, name: 'Brightside Dental' } })).toBe(0)
    expect(await db.note.count({ where: { workspaceId: ws.id } })).toBe(0)
  })
})

describe('grounding and inference (rule 7)', () => {
  it('drops anything the note does not say; never infers status', async () => {
    setAssistantProvider(new Reader(() => ({
      person: { firstName: 'Sarah', lastName: 'Lee', title: 'CTO', email: 'sarah@brightside.example', phone: '555-0100' },
      company: { name: 'Brightside Dental', domain: 'brightside.example' },
      followUp: { date: friday(), quote: 'call her on Monday' },
      facts: [{ key: 'budget', value: '$50,000', quote: 'a huge budget' }, { key: 'need', value: 'A new website', quote: 'want a new website' }],
    })))
    const { base } = await workspace()
    const p = (await addNote(base, { text: NOTE })).json().data.proposal
    expect(p.diff.map((r: any) => r.label)).toEqual(['Name', 'Company', 'Need', 'Note'])
    const row = await db.agentProposal.findUniqueOrThrow({ where: { id: p.id } })
    expect((row.evidence as any).dropped.sort()).toEqual(['domain', 'email', 'fact:budget', 'followUp', 'phone', 'title'])
  })

  it('the grounding check is plain code: quotes must be verbatim, dates in a sane window', () => {
    const g = ground('Call Ana next Tuesday about the quote.', { person: { firstName: 'Ana', lastName: 'Ruiz', title: null, email: null, phone: null }, company: { name: null, domain: null }, followUp: { date: '2099-01-01', quote: 'next Tuesday' }, facts: [] }, '2026-10-06')
    expect(g.person).toMatchObject({ firstName: 'Ana', lastName: null })
    expect(g.followUp).toEqual({ date: null, quote: null })
    expect(g.dropped.sort()).toEqual(['followUp', 'lastName'])
  })
})

describe('matching (rules 2, 3, 5)', () => {
  it('an existing contact: changes become diffs; status is never touched', async () => {
    setAssistantProvider(new Reader((n) => ({ ...READ, person: { ...READ.person, title: 'office manager' }, followUp: { date: friday(), quote: 'call Friday' } })))
    const { ws, base } = await workspace()
    const sarah = await seedContact(ws.id, ['Sarah', 'Lee'], { title: 'Manager', account: 'Brightside Dental', leadStatus: 'qualified' })
    const p = (await addNote(base, { text: `${NOTE} She is the office manager.` })).json().data.proposal
    expect(p).toMatchObject({ title: 'Update Sarah Lee', targetId: sarah.id })
    expect(p.diff.filter((r: any) => ['Title', 'Follow up', 'Company'].includes(r.label)).map((r: any) => [r.label, r.before, r.after])).toEqual([
      ['Title', 'Manager', 'office manager'],
      ['Follow up', '', expect.stringMatching(/^Fri, /)],
    ]) // already at Brightside Dental: no company row
    await act(base, p.id, 'apply')
    expect(await db.contact.findUniqueOrThrow({ where: { id: sarah.id } })).toMatchObject({ title: 'office manager', leadStatus: 'qualified' })
  })

  it('two people with that name: a choice, not a guess — then the chosen one (or a new one)', async () => {
    setAssistantProvider(new Reader(() => ({ ...READ, company: { name: null, domain: null }, followUp: { date: null, quote: null } })))
    const { ws, base } = await workspace()
    const dental = await seedContact(ws.id, ['Sarah', 'Lee'], { account: 'Brightside Dental' })
    await seedContact(ws.id, ['Sarah', 'Lee'], { account: 'Brightside Media' })
    const res = await addNote(base, { text: 'Met Sarah Lee. They want a new website early Q1.' })
    expect(res.statusCode).toBe(200)
    await validateResponse('addCrmNote', 200, res.json())
    const { status, draftId, contacts } = res.json().data
    expect(status).toBe('ambiguous')
    expect(contacts.map((c: any) => c.label).sort()).toEqual(['Sarah Lee — Brightside Dental', 'Sarah Lee — Brightside Media'])
    const reader = (await import('../bots/assistant/provider')).assistantProvider() as Reader
    const chosen = await addNote(base, { draftId, contactId: dental.id })
    expect(chosen.json().data).toMatchObject({ status: 'proposed', proposal: { targetId: dental.id, title: 'Update Sarah Lee' } })
    expect(reader.reads).toHaveLength(1) // the note was read once
    expect((await addNote(base, { draftId, contactId: dental.id })).statusCode).toBe(404) // the draft is done
  })

  it('a named company narrows the person; an ambiguous company is a choice too', async () => {
    setAssistantProvider(new Reader(() => ({ ...READ, followUp: { date: null, quote: null } })))
    const { ws, base } = await workspace()
    const dental = await seedContact(ws.id, ['Sarah', 'Lee'], { account: 'Brightside Dental' })
    await seedContact(ws.id, ['Sarah', 'Lee'], { account: 'Brightside Media' })
    expect((await addNote(base, { text: NOTE })).json().data.proposal.targetId).toBe(dental.id)

    await db.account.create({ data: { workspaceId: ws.id, name: 'Acme' } })
    await db.account.create({ data: { workspaceId: ws.id, name: 'Acme', domain: 'acme.example' } })
    setAssistantProvider(new Reader(() => ({ ...READ, person: { ...READ.person, firstName: 'Tom', lastName: 'Hale' }, company: { name: 'Acme', domain: null }, followUp: { date: null, quote: null }, facts: [] })))
    const amb = (await addNote(base, { text: 'Tom Hale at Acme wants a demo.' })).json().data
    expect(amb.status).toBe('ambiguous')
    expect(amb.accounts.map((a: any) => a.label).sort()).toEqual(['Acme', 'Acme (acme.example)'])
    const none = (await addNote(base, { draftId: amb.draftId, accountId: 'none' })).json().data
    expect(none.proposal.diff.map((r: any) => r.label)).toEqual(['Name', 'Note'])
  })
})

describe('lifecycle on CRM records (rule 9)', () => {
  it('stale: the contact changed under it → expired; Refresh plans again against now', async () => {
    setAssistantProvider(new Reader())
    const { ws, base } = await workspace()
    const sarah = await seedContact(ws.id, ['Sarah', 'Lee'], { account: 'Brightside Dental' })
    const p = (await addNote(base, { text: NOTE })).json().data.proposal
    await db.contact.update({ where: { id: sarah.id }, data: { version: { increment: 1 }, nextFollowUp: new Date('2026-12-01T12:00:00Z') } })
    expect((await act(base, p.id, 'apply')).json().code).toBe('PROPOSAL_EXPIRED')
    const fresh = await act(base, p.id, 'refresh')
    expect(fresh.statusCode).toBe(201)
    expect(fresh.json().data.diff.find((r: any) => r.label === 'Follow up').before).toBe('Tue, Dec 1')
  })

  it('a new person who was added meanwhile (same email) → Apply refuses', async () => {
    setAssistantProvider(new Reader(() => ({ ...READ, person: { ...READ.person, email: 'sarah@brightside.example' }, followUp: { date: null, quote: null } })))
    const { ws, base } = await workspace()
    const p = (await addNote(base, { text: `${NOTE} sarah@brightside.example` })).json().data.proposal
    expect(p.diff.find((r: any) => r.label === 'Email')).toMatchObject({ after: 'sarah@brightside.example' })
    const other = await db.contact.create({ data: { workspaceId: ws.id, displayName: 'S. Lee' } })
    await db.contactPoint.create({ data: { workspaceId: ws.id, contactId: other.id, kind: 'email', value: 'sarah@brightside.example', normalized: 'sarah@brightside.example' } })
    expect((await act(base, p.id, 'apply')).json().code).toBe('PROPOSAL_EXPIRED')
    expect(await db.contact.count({ where: { workspaceId: ws.id } })).toBe(1)
  })

  it('edit before apply: corrected values re-validate and re-describe; an existing name is not editable', async () => {
    setAssistantProvider(new Reader())
    const { ws, base } = await workspace()
    const p = (await addNote(base, { text: NOTE })).json().data.proposal
    const edited = await call(testUserId, 'PUT', `${base}/proposals/${p.id}`, { edits: { name: 'Sara Lee', followUp: '2026-10-20', company: 'Brightside Dental Group' } })
    expect(edited.statusCode).toBe(200)
    await validateResponse('editProposal', 200, edited.json())
    expect(edited.json().data).toMatchObject({ title: 'Add Sara Lee to CRM' })
    expect(edited.json().data.diff.find((r: any) => r.label === 'Follow up').after).toBe('Tue, Oct 20')
    expect((await call(testUserId, 'PUT', `${base}/proposals/${p.id}`, { edits: { followUp: 'Friday' } })).json().code).toBe('INVALID_EDIT')
    await act(base, p.id, 'apply')
    expect(await db.account.findFirstOrThrow({ where: { workspaceId: ws.id } })).toMatchObject({ name: 'Brightside Dental Group' })

    const sarah = await db.contact.findFirstOrThrow({ where: { workspaceId: ws.id } })
    const again = (await addNote(base, { text: NOTE, about: 'Sara Lee' })).json().data.proposal
    expect(again.targetId).toBe(sarah.id)
    expect((await call(testUserId, 'PUT', `${base}/proposals/${again.id}`, { edits: { name: 'X' } })).json().code).toBe('INVALID_EDIT')
  })

  it('undo removes what Apply made and restores what it changed — only while nothing changed since', async () => {
    setAssistantProvider(new Reader())
    const { ws, base } = await workspace()
    const created = (await addNote(base, { text: NOTE })).json().data.proposal
    await act(base, created.id, 'apply')
    expect((await act(base, created.id, 'undo')).json().data.status).toBe('undone')
    expect(await db.contact.count({ where: { workspaceId: ws.id, deletedAt: null } })).toBe(0)
    expect(await db.account.count({ where: { workspaceId: ws.id, deletedAt: null } })).toBe(0)
    expect(await db.note.count({ where: { workspaceId: ws.id, deletedAt: null } })).toBe(0)

    const sarah = await seedContact(ws.id, ['Sarah', 'Lee'], { title: 'Manager', account: 'Brightside Dental' })
    await db.contact.update({ where: { id: sarah.id }, data: { nextFollowUp: new Date('2026-11-02T12:00:00Z') } })
    const upd = (await addNote(base, { text: NOTE })).json().data.proposal
    await act(base, upd.id, 'apply')
    expect((await act(base, upd.id, 'undo')).statusCode).toBe(200)
    const back = await db.contact.findUniqueOrThrow({ where: { id: sarah.id } })
    expect(back.nextFollowUp!.toISOString().slice(0, 10)).toBe('2026-11-02')

    const third = (await addNote(base, { text: NOTE })).json().data.proposal
    await act(base, third.id, 'apply')
    await db.contact.update({ where: { id: sarah.id }, data: { version: { increment: 1 }, title: 'Director' } })
    expect((await act(base, third.id, 'undo')).json().code).toBe('PROPOSAL_UNDO_STALE')
    expect((await act(base, third.id, 'revert')).json().code).toBe('NOT_REVERTIBLE')
    expect((await db.contact.findUniqueOrThrow({ where: { id: sarah.id } })).title).toBe('Director') // newer work stands
  })

  it('members add notes and apply them (record.write); outsiders get 404', async () => {
    setAssistantProvider(new Reader())
    const { ws, base } = await workspace()
    await join(app, ws.id, carolId, 'carol@test.local')
    const p = (await addNote(base, { text: NOTE }, carolId)).json().data.proposal
    expect(p.requires).toBe('member')
    expect((await act(base, p.id, 'apply', carolId)).statusCode).toBe(200)
    expect((await addNote(base, { text: NOTE }, 'ws-test-dave')).statusCode).toBe(404)
  })
})

describe('AI off, and the channel', () => {
  it('AI off: "who is this about?" → a note-only proposal', async () => {
    setAssistantProvider(null)
    const { ws, base } = await workspace()
    const first = (await addNote(base, { text: NOTE })).json().data
    expect(first.status).toBe('needs-person')
    const p = (await addNote(base, { draftId: first.draftId, about: 'Sarah Lee' })).json().data.proposal
    expect(p.diff.map((r: any) => r.label)).toEqual(['Name', 'Note'])
    await act(base, p.id, 'apply')
    expect((await db.note.findFirstOrThrow({ where: { workspaceId: ws.id }, include: { message: true } })).message.text).toBe(NOTE)
  })

  it('"note: …" in the channel → a card; an ambiguous person → a choice → a card', async () => {
    setAssistantProvider(new Reader(() => ({ ...READ, company: { name: null, domain: null }, followUp: { date: null, quote: null } })))
    const { ws, roomId } = await workspace()
    const lastBot = async () => (await db.item.findMany({ where: { roomId, message: { authorId: bot.userId } }, include: { message: true }, orderBy: { number: 'asc' } })).at(-1)!
    expect((await call(testUserId, 'POST', `/rooms/${roomId}/items`, { text: `note: ${NOTE}`, chat: true })).statusCode).toBe(201)
    await host.idle()
    const card = (await call(testUserId, 'GET', `/items/${(await lastBot()).id}`)).json().data
    expect(card.proposal).toMatchObject({ kind: 'crm.note', title: 'Add Sarah Lee to CRM' })

    await seedContact(ws.id, ['Sarah', 'Lee'], { account: 'Brightside Dental' })
    await seedContact(ws.id, ['Sarah', 'Lee'], { account: 'Brightside Media' })
    await call(testUserId, 'POST', `/rooms/${roomId}/items`, { text: 'note: Sarah Lee wants a quote.', chat: true })
    await host.idle()
    const choice = await lastBot()
    expect(choice.message.text).toBe('Which person is this note about?')
    const options = (await call(testUserId, 'GET', `/items/${choice.id}`)).json().data.message.actions.options
    expect(options.map((o: any) => o.label).sort()).toEqual(['New contact', 'Sarah Lee — Brightside Dental', 'Sarah Lee — Brightside Media'])
    await call(testUserId, 'POST', `/items/${choice.id}/choice`, { optionIds: ['new'] })
    await host.idle()
    expect((await call(testUserId, 'GET', `/items/${(await lastBot()).id}`)).json().data.proposal).toMatchObject({ title: 'Add Sarah Lee to CRM', targetId: 'new' })
  })
})

describe('planNote (unit)', () => {
  it('needs someone to be about', async () => {
    const { ws } = await workspace()
    await expect(planNote(ws.id, 'Nice weather today.', null)).rejects.toMatchObject({ code: 'NO_PERSON' })
  })
})
