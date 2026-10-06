// doc/13 §13 — minimum necessary context. Every AI job has a contract: its only input
// fields, a record cap, and input/output token ceilings; our ids never reach the model.
// Workflow tests run strict (a violation throws), so every workflow test also checks
// its contract; this file checks the contract itself and the worst cases.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId } from './helpers'
import { caller, createWorkspace, seedPeople } from './helpers/workspace'
import { JOBS, containsId, contractViolation, estimateTokens, type Job } from '../bots/assistant/budget'
import { PROMPT_CHARS, setAssistantProvider, type AssistantProvider, type BriefInput } from '../bots/assistant/provider'
import { planSheet, resetAssistantCaps, setStrictContracts } from '../bots/assistant/calls'

const app = buildTestApp()
const call = caller(app)
beforeEach(async () => { await seedPeople(); resetAssistantCaps() })
afterEach(() => { setAssistantProvider(undefined); setStrictContracts(true) })

const fits = (job: Job, input: object) => expect(contractViolation(job, input, PROMPT_CHARS[job])).toBeNull()

describe('the contract', () => {
  it('names one class and hard ceilings for every job; the fixed prompt leaves room for input', () => {
    for (const [job, c] of Object.entries(JOBS) as [Job, (typeof JOBS)[Job]][]) {
      expect(['extract', 'plan', 'compose']).toContain(c.class)
      expect(c.outputTokens).toBeGreaterThan(0)
      expect(estimateTokens(PROMPT_CHARS[job])).toBeLessThan(c.inputTokens * 0.9)
    }
    expect(JOBS['sheet.plan']).toMatchObject({ class: 'plan', inputTokens: 1100, outputTokens: 300 })
  })

  it('refuses extra fields, our ids, too many records and oversized input', () => {
    const plan = { request: 'open leads', today: '2026-10-06', weekday: 'Tuesday', categories: ['Tools'] }
    fits('sheet.plan', plan)
    expect(contractViolation('sheet.plan', { ...plan, contacts: [] }, PROMPT_CHARS['sheet.plan'])).toMatch(/fields not allowed/)
    expect(contractViolation('sheet.plan', { ...plan, request: 'rows for cmux93q0800b9jn001vqiio8k' }, PROMPT_CHARS['sheet.plan'])).toMatch(/database id/)
    expect(contractViolation('sheet.plan', { ...plan, categories: Array.from({ length: 31 }, (_, i) => `C${i}`) }, PROMPT_CHARS['sheet.plan'])).toMatch(/31 records/)
    expect(contractViolation('note.read', { note: 'x '.repeat(4000), today: '2026-10-06', weekday: 'Tuesday' }, PROMPT_CHARS['note.read'])).toMatch(/input tokens/)
    expect(containsId('6f1c2a9e-1b2c-4d5e-8f90-123456789abc')).toBe(true)
    expect(containsId('Brightside Dental, E3, 2026-10-06, $8,000')).toBe(false)
  })

  it('worst-case inputs the workflows can build still fit', () => {
    fits('sheet.plan', { request: 'x'.repeat(300), today: '2026-10-06', weekday: 'Wednesday', categories: Array.from({ length: 30 }, (_, i) => `Category name ${i}`) })
    fits('note.read', { note: 'Met Sarah Lee from Brightside Dental. '.repeat(100), today: '2026-10-06', weekday: 'Tuesday' })
  })

  it('a refused call never reaches the provider and is logged as a failure', async () => {
    setStrictContracts(false)
    let reached = false
    setAssistantProvider({ name: 'fake', model: 'fake-1', extract: async () => { throw new Error('unused') }, draft: async () => { throw new Error('unused') }, planSheet: async () => { reached = true; throw new Error('unused') } } as AssistantProvider)
    const ws = await createWorkspace(app)
    const out = await planSheet({ workspaceId: ws.id, runId: null }, { request: `rows for ${ws.id}`, today: '2026-10-06', weekday: 'Tuesday', categories: [] })
    expect(out).toBeNull()
    expect(reached).toBe(false)
    expect((await db.assistantCall.findFirstOrThrow({ where: { workspaceId: ws.id } })).error).toBe('contract: database id in the input for sheet.plan')
  })
})

describe('Brief me sends a code-selected, aliased pack', () => {
  it('a busy contact: at most 20 items, newest first per kind, no ids, under budget', async () => {
    const inputs: BriefInput[] = []
    setAssistantProvider({ name: 'fake', model: 'fake-1', extract: async () => { throw new Error('unused') }, draft: async () => { throw new Error('unused') },
      brief: async (i: BriefInput) => { inputs.push(i); return { brief: { summary: [], need: [], recent: [], commitments: [], openQuestions: [], nextStep: null } } } } as AssistantProvider)
    const ws = await createWorkspace(app)
    const alice = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: ws.id, userId: testUserId } })
    const contact = await db.contact.create({ data: { workspaceId: ws.id, displayName: 'Sarah Lee' } })
    for (let i = 0; i < 30; i++) {
      const m = await db.message.create({ data: { authorId: testUserId, text: `Note ${i}: ${'details about the website project and its budget. '.repeat(12)}`, createdAt: new Date(Date.UTC(2026, 8, 1 + i)) } })
      const n = await db.note.create({ data: { workspaceId: ws.id, messageId: m.id, authorMemberId: alice.id, createdAt: new Date(Date.UTC(2026, 8, 1 + i)) } })
      await db.recordLink.create({ data: { workspaceId: ws.id, contactId: contact.id, noteId: n.id, pairKey: `contact:${contact.id}|note:${n.id}` } })
    }
    expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/contacts/${contact.id}/brief`)).statusCode).toBe(200)
    const sent = inputs[0]!
    expect(sent.evidence.length).toBeLessThanOrEqual(JOBS['contact.brief'].records!.max)
    expect(sent.evidence.map((e) => e.id)).toEqual(sent.evidence.map((_, i) => `E${i + 1}`))
    expect(sent.evidence.filter((e) => e.kind === 'note').map((e) => e.text.split(':')[0])).toEqual(['Note 29', 'Note 28', 'Note 27', 'Note 26', 'Note 25', 'Note 24'])
    expect(containsId(JSON.stringify(sent))).toBe(false)
    fits('contact.brief', sent)
  })
})
