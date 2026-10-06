// doc/13 D3 — "Brief me": read-only intelligence. A bounded evidence pack (with the
// viewer's permissions), a structured brief whose facts cite it, the suggested next
// step labelled inference, a stale check, and no records changed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, join, seedPeople } from './helpers/workspace'
import { setAssistantProvider, type AssistantProvider, type Brief, type BriefInput } from '../bots/assistant/provider'
import { resetAssistantCaps } from '../bots/assistant/calls'
import { buildPack } from '../services/contactBrief'

const app = buildTestApp()
const call = caller(app)
beforeEach(async () => { await seedPeople(); resetAssistantCaps() })
afterEach(() => setAssistantProvider(undefined))

class Briefer implements AssistantProvider {
  readonly name = 'fake'
  readonly model = 'fake-1'
  inputs: BriefInput[] = []
  constructor(private make: (i: BriefInput) => Brief) {}
  async extract(): Promise<never> { throw new Error('unused') }
  async draft(): Promise<never> { throw new Error('unused') }
  async brief(input: BriefInput) { this.inputs.push(input); return { brief: this.make(input), usage: { promptTokens: 900, completionTokens: 200 } } }
}

const NOTE = 'Met Sarah Lee from Brightside Dental. They want a new website early Q1, budget around $8k. I said I would send pricing by Friday.'
async function seed() {
  const ws = await createWorkspace(app)
  const base = `/workspaces/${ws.id}`
  const alice = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: ws.id, userId: testUserId } })
  const account = await db.account.create({ data: { workspaceId: ws.id, name: 'Brightside Dental', domain: 'brightside.example', domainKey: 'brightside.example' } })
  const contact = await db.contact.create({ data: { workspaceId: ws.id, firstName: 'Sarah', lastName: 'Lee', displayName: 'Sarah Lee', title: 'Office manager', nextFollowUp: new Date('2026-10-09T12:00:00Z') } })
  await db.contactAccount.create({ data: { workspaceId: ws.id, contactId: contact.id, accountId: account.id, isPrimary: true } })
  const message = await db.message.create({ data: { authorId: testUserId, text: NOTE } })
  const note = await db.note.create({ data: { workspaceId: ws.id, messageId: message.id, authorMemberId: alice.id, facts: [{ key: 'need', value: 'A new website', quote: 'want a new website' }, { key: 'budget', value: 'About $8,000', quote: 'budget around $8k' }] } })
  await db.recordLink.create({ data: { workspaceId: ws.id, contactId: contact.id, noteId: note.id, pairKey: `contact:${contact.id}|note:${note.id}`, linkedById: alice.id } })
  return { ws, base, contact, account, note, alice }
}
async function linkRoom(ws: string, contactId: string, visibility: 'public' | 'private', text: string) {
  const room = await db.room.create({ data: { title: `Deal room ${visibility}`, visibility, ownerId: testUserId, members: { create: { userId: testUserId, role: 'owner' } } } })
  const message = await db.message.create({ data: { authorId: testUserId, text } })
  const item = await db.item.create({ data: { roomId: room.id, messageId: message.id, number: 1, chat: true } })
  await db.recordLink.create({ data: { workspaceId: ws, contactId, roomId: room.id, pairKey: `contact:${contactId}|room:${room.id}` } })
  return { room, item }
}
const snapshot = async (ws: string) => JSON.stringify(await Promise.all([
  db.contact.findMany({ where: { workspaceId: ws }, orderBy: { id: 'asc' } }),
  db.account.findMany({ where: { workspaceId: ws }, orderBy: { id: 'asc' } }),
  db.note.count({ where: { workspaceId: ws } }), db.activity.count({ where: { workspaceId: ws } }),
  db.actionExecution.count({ where: { workspaceId: ws } }), db.agentProposal.count({ where: { workspaceId: ws } }),
]))

describe('Brief me (AI off: the template)', () => {
  it('no brief until asked; then a grounded brief from the records, with only the evidence it cites', async () => {
    setAssistantProvider(null)
    const { base, contact, account, note } = await seed()
    const none = await call(testUserId, 'GET', `${base}/contacts/${contact.id}/brief`)
    expect(none.statusCode).toBe(200)
    await validateResponse('getContactBrief', 200, none.json())
    expect(none.json().data).toBeNull()

    const res = await call(testUserId, 'POST', `${base}/contacts/${contact.id}/brief`)
    expect(res.statusCode).toBe(200)
    await validateResponse('generateContactBrief', 200, res.json())
    const b = res.json().data
    expect(b).toMatchObject({ generator: 'template', stale: false })
    expect(b.summary[0]).toEqual({ text: 'Sarah Lee, Office manager at Brightside Dental.', evidence: [`contact:${contact.id}`, `account:${account.id}`] })
    expect(b.need.map((c: any) => c.text)).toEqual(['Need: A new website.', 'Budget: About $8,000.'])
    expect(b.need.every((c: any) => c.evidence[0] === `note:${note.id}`)).toBe(true)
    expect(b.openQuestions.map((c: any) => c.text)).toEqual(['No email on file.', 'No phone number on file.'])
    expect(b.nextStep).toEqual({ text: 'Follow up on Oct 9, 2026, as planned.', basis: [`contact:${contact.id}`] })
    // Every cited id is in the returned evidence, and nothing uncited is.
    const cited = new Set([...b.summary, ...b.need, ...b.recent, ...b.openQuestions].flatMap((c: any) => c.evidence).concat(b.nextStep.basis))
    expect(new Set(b.evidence.map((e: any) => e.id))).toEqual(cited)
    expect(b.evidence.find((e: any) => e.kind === 'account').link).toEqual({ type: 'account', id: account.id })
  })

  it('is read-only: no record, timeline or action changes', async () => {
    setAssistantProvider(null)
    const { ws, base, contact } = await seed()
    const before = await snapshot(ws.id)
    await call(testUserId, 'POST', `${base}/contacts/${contact.id}/brief`)
    await call(testUserId, 'GET', `${base}/contacts/${contact.id}/brief`)
    expect(await snapshot(ws.id)).toBe(before)
  })

  it('stale is detectable: new evidence → stale; a fresh brief → not', async () => {
    setAssistantProvider(null)
    const { ws, base, contact, alice } = await seed()
    await call(testUserId, 'POST', `${base}/contacts/${contact.id}/brief`)
    expect((await call(testUserId, 'GET', `${base}/contacts/${contact.id}/brief`)).json().data.stale).toBe(false)
    const m = await db.message.create({ data: { authorId: testUserId, text: 'She called back: budget is now $12k.' } })
    const n = await db.note.create({ data: { workspaceId: ws.id, messageId: m.id, authorMemberId: alice.id } })
    await db.recordLink.create({ data: { workspaceId: ws.id, contactId: contact.id, noteId: n.id, pairKey: `contact:${contact.id}|note:${n.id}` } })
    expect((await call(testUserId, 'GET', `${base}/contacts/${contact.id}/brief`)).json().data.stale).toBe(true)
    await call(testUserId, 'POST', `${base}/contacts/${contact.id}/brief`)
    expect((await call(testUserId, 'GET', `${base}/contacts/${contact.id}/brief`)).json().data.stale).toBe(false)
    // A field change counts too.
    await db.contact.update({ where: { id: contact.id }, data: { title: 'Practice manager' } })
    expect((await call(testUserId, 'GET', `${base}/contacts/${contact.id}/brief`)).json().data.stale).toBe(true)
  })
})

describe('the evidence pack', () => {
  it('uses the viewer’s permissions: a private room’s messages reach only its members', async () => {
    const { ws, contact } = await seed()
    await join(app, ws.id, carolId, 'carol@test.local')
    await linkRoom(ws.id, contact.id, 'private', 'Sarah agreed to a call on Friday.')
    const open = await linkRoom(ws.id, contact.id, 'public', 'Sent the intro deck.')
    const alice = (await buildPack(testUserId, ws.id, contact.id)).pack.filter((e) => e.kind === 'message').map((e) => e.text)
    const carol = (await buildPack(carolId, ws.id, contact.id)).pack.filter((e) => e.kind === 'message').map((e) => e.text)
    expect(alice.sort()).toEqual(['Sarah agreed to a call on Friday.', 'Sent the intro deck.'])
    expect(carol).toEqual(['Sent the intro deck.'])
    expect((await buildPack(carolId, ws.id, contact.id)).pack.find((e) => e.kind === 'message')!.link).toEqual({ type: 'room', roomId: open.room.id })
  })

  it('includes documents linked to those rooms; stays bounded', async () => {
    const { ws, contact, alice } = await seed()
    const { room } = await linkRoom(ws.id, contact.id, 'public', 'Here is the proposal.')
    const doc = await db.document.create({ data: { workspaceId: ws.id, ownerMemberId: alice.id, title: 'Brightside proposal', surface: 'blocks', sourceKind: 'native', descriptor: { surface: 'blocks', source: { kind: 'native', schemaVersion: 1 } } } })
    await db.documentContent.create({ data: { documentId: doc.id, workspaceId: ws.id, version: 1, content: [{ id: 'a', type: 'section', level: 'body', text: 'Website rebuild, 6 weeks, $8,000.' }] } })
    await db.documentRoomLink.create({ data: { workspaceId: ws.id, documentId: doc.id, roomId: room.id } })
    for (let i = 0; i < 20; i++) {
      const m = await db.message.create({ data: { authorId: testUserId, text: `Extra note ${i}` } })
      const n = await db.note.create({ data: { workspaceId: ws.id, messageId: m.id, authorMemberId: alice.id } })
      await db.recordLink.create({ data: { workspaceId: ws.id, contactId: contact.id, noteId: n.id, pairKey: `contact:${contact.id}|note:${n.id}` } })
    }
    const { pack } = await buildPack(testUserId, ws.id, contact.id)
    expect(pack.find((e) => e.kind === 'document')).toMatchObject({ title: 'Brightside proposal', text: 'Website rebuild, 6 weeks, $8,000.', link: { type: 'document', id: doc.id } })
    expect(pack.filter((e) => e.kind === 'note')).toHaveLength(12)
  })
})

describe('Brief me (AI)', () => {
  it('facts must cite the pack; specifics must be in what they cite; the next step is labelled inference', async () => {
    const { ws, base, contact, note } = await seed()
    const fake = new Briefer((i) => {
      const c = i.evidence.find((e) => e.kind === 'contact')!.id
      return {
        summary: [{ text: 'Sarah Lee is the office manager at Brightside Dental.', evidence: [c, i.evidence.find((e) => e.kind === 'account')!.id] }],
        need: [{ text: 'A new website early in Q1, budget about $8,000.', evidence: [note.id && `note:${note.id}`] }, { text: 'Wants a $50,000 rebuild.', evidence: [`note:${note.id}`] }],
        recent: [{ text: 'Invented meeting.', evidence: ['note:does-not-exist'] }],
        commitments: [{ text: 'We promised pricing by Friday.', evidence: [`note:${note.id}`] }],
        openQuestions: [{ text: 'No email on file.', evidence: [c] }],
        nextStep: { text: 'Send pricing before Friday.', basis: [`note:${note.id}`] },
      }
    })
    setAssistantProvider(fake)
    const b = (await call(testUserId, 'POST', `${base}/contacts/${contact.id}/brief`)).json().data
    expect(b).toMatchObject({ generator: 'ai', model: 'fake-1' })
    expect(b.need.map((c: any) => c.text)).toEqual(['A new website early in Q1, budget about $8,000.']) // $50,000 dropped
    expect(b.recent).toEqual([]) // cites nothing real
    expect(b.commitments.map((c: any) => c.text)).toEqual(['We promised pricing by Friday.'])
    expect(b.nextStep).toEqual({ text: 'Send pricing before Friday.', basis: [`note:${note.id}`] })
    // The model saw the pack without app links; the call is logged.
    expect(fake.inputs[0]!.evidence.every((e: any) => !('link' in e))).toBe(true)
    expect(await db.assistantCall.count({ where: { workspaceId: ws.id } })).toBe(1)
  })

  it('a failed call falls back to the template', async () => {
    setAssistantProvider(new Briefer(() => { throw new Error('down') }))
    const { base, contact } = await seed()
    expect((await call(testUserId, 'POST', `${base}/contacts/${contact.id}/brief`)).json().data.generator).toBe('template')
  })

  it('outsiders get 404; each member has their own brief', async () => {
    setAssistantProvider(null)
    const { ws, base, contact } = await seed()
    expect((await call('ws-test-dave', 'POST', `${base}/contacts/${contact.id}/brief`)).statusCode).toBe(404)
    await join(app, ws.id, carolId, 'carol@test.local')
    await call(testUserId, 'POST', `${base}/contacts/${contact.id}/brief`)
    expect((await call(carolId, 'GET', `${base}/contacts/${contact.id}/brief`)).json().data).toBeNull()
  })
})
