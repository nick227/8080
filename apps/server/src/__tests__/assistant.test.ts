// doc/12 Slice C — the assistant in the company-profile workflow: one open question,
// one extraction, ≤3 follow-ups, the brief, one drafted document. The model returns
// data only; every failure takes the deterministic path. Fake provider throughout.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { db } from '@project/db'
import { buildTestApp, testUserId, seedBotUser } from './helpers'
import { caller, createWorkspace, seedPeople } from './helpers/workspace'
import { startWorkspaceHost } from '../services/WorkspaceHost'
import { CompanyProfileService } from '../services/CompanyProfileService'
import { OpenAIAssistant, assistantProvider, setAssistantProvider, type AssistantProvider, type DraftInput, type ExtractInput, type Facts } from '../bots/assistant/provider'
import { draftDocument, resetAssistantCaps } from '../bots/assistant/calls'
import { WRITING_RULES, flagCount, isClean, problemsOf, styleFlags } from '../bots/assistant/style'
import { assistantConfig } from '../bots/assistant/config'

// The shared channel also carries curated workspace activity (activityEvent.ts);
// these tests follow the workflows' own lines.
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
const env = ['AI_ASSISTANT_WORKSPACE_DAILY_MAX', 'AI_ASSISTANT_DAILY_USD', 'AI_ASSISTANT_EXTRACT_TIMEOUT_MS']
afterEach(() => {
  setAssistantProvider(undefined)
  for (const k of env) delete process.env[k]
})

const NONE: Facts = { name: null, location: null, serviceArea: null, purpose: null, brandVoice: null, offerings: [], customers: [], differentiators: [] }
const ABOUT = 'We are Midnight Creative in Austin. We build websites and automation stuff for small businesses, fast and with real depth.'

class Fake implements AssistantProvider {
  readonly name = 'fake'
  readonly model = 'fake-1'
  extracts: ExtractInput[] = []
  drafts: DraftInput[] = []
  constructor(
    private onExtract: (i: ExtractInput) => Promise<Facts> | Facts = () => ({ ...NONE, name: 'Midnight Creative', location: 'Austin', purpose: 'Builds websites and automation for small businesses', offerings: ['websites and automation stuff'], differentiators: ['fast, with real depth'] }),
    private onDraft: (i: DraftInput) => Promise<{ patch: Facts; document: { title: string; paragraphs: string[] } }> | { patch: Facts; document: { title: string; paragraphs: string[] } } = (i) => ({
      patch: { ...NONE, offerings: ['Web design', 'AI automation'] },
      document: { title: `${i.profile.name} — Company Description`, paragraphs: [`${i.profile.name} helps ${i.brief.audience} in ${i.profile.location ?? 'its area'}.`, 'Second paragraph.'] },
    }),
  ) {}
  async extract(input: ExtractInput) { this.extracts.push(input); return { facts: await this.onExtract(input), usage: { promptTokens: 300, completionTokens: 80 } } }
  async draft(input: DraftInput) { this.drafts.push(input); return { ...(await this.onDraft(input)), usage: { promptTokens: 900, completionTokens: 400 } } }
}

async function channel() {
  const ws = await createWorkspace(app)
  await host.idle()
  const { roomId } = await db.workspaceChannel.findUniqueOrThrow({ where: { workspaceId: ws.id } })
  return { ws, roomId }
}
const lastBot = async (roomId: string) =>
  (await db.item.findMany({ where: { roomId, message: { authorId: bot.userId, OR: [{ workflow: null }, { workflow: { not: 'workspace-activity' } }] } }, include: { message: true }, orderBy: { number: 'asc' } })).at(-1)!
const botTexts = async (roomId: string) =>
  (await db.item.findMany({ where: { roomId, message: { authorId: bot.userId, OR: [{ workflow: null }, { workflow: { not: 'workspace-activity' } }] } }, include: { message: true }, orderBy: { number: 'asc' } })).map((i) => i.message.text)
async function click(roomId: string, optionIds: string[]) {
  const res = await call(testUserId, 'POST', `/items/${(await lastBot(roomId)).id}/choice`, { optionIds })
  expect(res.statusCode).toBe(200)
  await host.idle()
}
async function say(roomId: string, text: string) {
  expect((await call(testUserId, 'POST', `/rooms/${roomId}/items`, { text, chat: true })).statusCode).toBe(201)
  await host.idle()
}
const run = (workspaceId: string) => db.workflowRun.findFirstOrThrow({ where: { workspaceId }, orderBy: { createdAt: 'desc' } })
const doc = async (roomId: string) => {
  const link = (await lastBot(roomId)).message.links as { id: string }[] | null
  return db.document.findUniqueOrThrow({ where: { id: link![0]!.id }, include: { content: true } })
}

describe('assisted company profile', () => {
  it('one open answer → extraction → only the missing facts → brief → drafted document', async () => {
    const fake = new Fake()
    setAssistantProvider(fake)
    const { ws, roomId } = await channel()
    await click(roomId, ['setup'])
    expect((await lastBot(roomId)).message.text).toMatch(/^Tell me about your company in your own words/)
    await say(roomId, ABOUT)

    // Extracted name, location, purpose, offerings, differentiator → asks area and customers only.
    expect(fake.extracts).toHaveLength(1)
    expect(fake.extracts[0]!.text).toBe(ABOUT)
    expect((await lastBot(roomId)).message.text).toBe('Where does Midnight Creative work?')
    expect((await run(ws.id)).state).toMatchObject({ mode: 'assisted', followUps: ['area', 'customers'] })
    await click(roomId, ['regional'])
    expect((await lastBot(roomId)).message.text).toBe('Who does Midnight Creative sell to? Pick all that apply.')
    await click(roomId, ['businesses'])
    for (const answer of ['friendly', 'customers', 'medium']) await click(roomId, [answer])

    // The drafted document, shared with the workspace, with its provenance.
    const texts = await botTexts(roomId)
    expect(texts.at(-1)).toMatch(/^I drafted Midnight Creative — Company Description and saved what I learned.*Some of it I read from your description/)
    const d = await doc(roomId)
    expect(d.workspaceAccess).toBe('viewer')
    expect(d.provenance).toMatchObject({ generator: 'ai', model: 'fake-1', brief: { audience: 'customers', length: 'medium' } })
    expect((d.content!.content as { text: string }[]).map((b) => b.text)).toEqual(['Midnight Creative', 'Midnight Creative helps customers in Austin.', 'Second paragraph.'])

    // The drafting call got the person's own words and the brief.
    expect(fake.drafts[0]!.answers).toEqual([{ question: expect.stringMatching(/^Tell me about your company/), answer: ABOUT }])
    expect(fake.drafts[0]!.brief).toEqual({ audience: 'customers', length: 'medium', voice: 'friendly' })

    // Profile: what the model read is inferred; what the person answered is stated;
    // the tidy-up replaced only an inferred list.
    const profile = await new CompanyProfileService().current(ws.id)
    expect(profile).toMatchObject({ name: 'Midnight Creative', location: 'Austin', serviceArea: 'regional', brandVoice: 'friendly' })
    const sources = Object.fromEntries((await db.companyScalarSource.findMany({ where: { workspaceId: ws.id } })).map((s) => [s.field, s.status]))
    expect(sources).toEqual({ name: 'inferred', location: 'inferred', purpose: 'inferred', serviceArea: 'stated', brandVoice: 'stated' })
    expect(profile.facts.map((f) => [f.kind, f.value, f.status])).toEqual([
      ['offering', 'Web design', 'inferred'], ['offering', 'AI automation', 'inferred'],
      ['customer', 'Businesses', 'stated'],
      ['differentiator', 'fast, with real depth', 'inferred'],
    ])

    // Both calls logged with usage and an estimated cost.
    const calls = await db.assistantCall.findMany({ where: { workspaceId: ws.id }, orderBy: { at: 'asc' } })
    expect(calls.map((c) => [c.kind, c.error])).toEqual([['extract', null], ['generate', null]])
    expect(calls.every((c) => c.promptTokens! > 0 && c.costUsd! > 0 && c.model === 'fake-1')).toBe(true)
    expect((d.provenance as any).assistantCallId).toBe(calls[1]!.id)
  })

  it('asks at most three follow-ups; the name always comes first', async () => {
    setAssistantProvider(new Fake(() => NONE))
    const { ws, roomId } = await channel()
    await click(roomId, ['setup'])
    await say(roomId, 'we do stuff')
    expect((await run(ws.id)).state).toMatchObject({ followUps: ['name', 'area', 'location'] })
    expect((await lastBot(roomId)).message.text).toBe("What's your company called?")
    await say(roomId, 'Acme')
    await click(roomId, ['local'])
    await say(roomId, 'Boston')
    expect((await lastBot(roomId)).message.text).toBe('How should it sound?') // straight to the brief
  })

  it('a failed extraction falls back to the direct interview (and is logged)', async () => {
    setAssistantProvider(new Fake(() => { throw new Error('boom') }))
    const { ws, roomId } = await channel()
    await click(roomId, ['setup'])
    await say(roomId, ABOUT)
    const texts = await botTexts(roomId)
    expect(texts.slice(-2)).toEqual(["I couldn't read that just now, so let me ask a few quick questions instead.", "What's your company called?"])
    expect((await run(ws.id)).state).toMatchObject({ mode: 'direct' })
    expect(await db.assistantCall.findMany({ where: { workspaceId: ws.id } })).toMatchObject([{ kind: 'extract', error: 'boom' }])
  })

  it('a slow extraction times out into the same fallback', async () => {
    process.env.AI_ASSISTANT_EXTRACT_TIMEOUT_MS = '30'
    setAssistantProvider(new Fake(() => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 200))))
    // The fake ignores the abort signal; the call still reports the timeout.
    const { ws, roomId } = await channel()
    await click(roomId, ['setup'])
    await say(roomId, ABOUT)
    expect((await lastBot(roomId)).message.text).toBe("What's your company called?")
    expect((await db.assistantCall.findFirstOrThrow({ where: { workspaceId: ws.id } })).error).toMatch(/timeout|late/)
  })

  it('a failed or invalid draft still creates the document from the template, and says so', async () => {
    setAssistantProvider(new Fake(undefined, () => ({ patch: NONE, document: { title: '', paragraphs: [] } })))
    const { ws, roomId } = await channel()
    await click(roomId, ['setup'])
    await say(roomId, ABOUT)
    for (const answer of [['regional'], ['businesses'], ['friendly'], ['customers'], ['short']]) await click(roomId, answer)
    expect((await botTexts(roomId)).at(-1)).toMatch(/from a template — I couldn't reach the writing model just now/)
    const d = await doc(roomId)
    expect(d.provenance).toMatchObject({ generator: 'template' })
    expect((d.content!.content as { text: string }[])[1]!.text).toMatch(/^Midnight Creative is a team based in Austin and works across the region\./)
    expect((await db.assistantCall.findMany({ where: { workspaceId: ws.id }, orderBy: { at: 'asc' } })).map((c) => c.error)).toEqual([null, 'invalid output'])
  })
})

describe('rails', () => {
  it('off: no provider → the direct interview, no calls', async () => {
    setAssistantProvider(null)
    const { ws, roomId } = await channel()
    await click(roomId, ['setup'])
    expect((await lastBot(roomId)).message.text).toBe("What's your company called?")
    expect(await db.assistantCall.count({ where: { workspaceId: ws.id } })).toBe(0)
  })

  it('the per-workspace cap: none left → direct; one left → extraction, then a template draft', async () => {
    process.env.AI_ASSISTANT_WORKSPACE_DAILY_MAX = '0'
    const fake = new Fake()
    setAssistantProvider(fake)
    const a = await channel()
    await click(a.roomId, ['setup'])
    expect((await lastBot(a.roomId)).message.text).toBe("What's your company called?")

    process.env.AI_ASSISTANT_WORKSPACE_DAILY_MAX = '1'
    await db.workflowRun.deleteMany({ where: { workspaceId: a.ws.id } })
    const b = await channel()
    await click(b.roomId, ['setup'])
    await say(b.roomId, ABOUT)
    for (const answer of [['regional'], ['businesses'], ['friendly'], ['customers'], ['short']]) await click(b.roomId, answer)
    expect((await doc(b.roomId)).provenance).toMatchObject({ generator: 'template' })
    expect(fake.extracts).toHaveLength(1)
    expect(fake.drafts).toHaveLength(0) // capped before the call — not even attempted
  })

  it('the daily spend cap stops calls', async () => {
    process.env.AI_ASSISTANT_DAILY_USD = '1'
    setAssistantProvider(new Fake())
    const { ws, roomId } = await channel()
    await db.assistantCall.create({ data: { workspaceId: ws.id, kind: 'extract', provider: 'fake', inputChars: 1, costUsd: 1.5 } })
    await click(roomId, ['setup'])
    expect((await lastBot(roomId)).message.text).toBe("What's your company called?")
  })

  it('never replaces a stated fact: a later assisted run keeps what a person said', async () => {
    setAssistantProvider(null)
    const { ws, roomId } = await channel()
    await click(roomId, ['setup'])
    for (const [kind, value] of [['t', 'Midnight Creative'], ['c', ['regional']], ['t', 'Austin, TX'], ['t', 'we build websites'], ['t', 'Web design'], ['c', ['businesses']], ['t', 'speed'], ['c', ['friendly']], ['c', ['customers']], ['c', ['short']]] as const) {
      if (kind === 't') await say(roomId, value as string)
      else await click(roomId, value as unknown as string[])
    }
    // Second run, assisted, where the model reads a different name and offerings.
    const profiles = new CompanyProfileService()
    const user = await db.user.findUniqueOrThrow({ where: { id: testUserId }, include: { profile: true } })
    await profiles.apply({ user, origin: 'assistant' }, ws.id, { name: 'Midnight Studio', offerings: ['Logos'], inferred: ['name', 'offerings'], sources: {} }, 'second')
    const p = await profiles.current(ws.id)
    expect(p.name).toBe('Midnight Creative')
    expect(p.facts.filter((f) => f.kind === 'offering').map((f) => f.value)).toEqual(['Web design'])
    expect(p.revision).toBe(2) // the attempt is still a recorded revision, with nothing changed
  })

  it('in tests the real provider is never used, whatever the environment says', () => {
    setAssistantProvider(undefined)
    process.env.AI_ASSISTANT = 'on'
    process.env.OPENAI_API_KEY = 'sk-test'
    try {
      expect(assistantConfig().enabled).toBe(false)
      expect(assistantProvider()).toBeNull()
    } finally {
      delete process.env.AI_ASSISTANT
      delete process.env.OPENAI_API_KEY
    }
  })
})

describe('the writing voice (style.ts)', () => {
  it('flags marketing words, promises, exclamations, first person, long sentences and a named tone', () => {
    const f = styleFlags([
      'We are a passionate team delivering innovative solutions! Midnight Creative guarantees results.',
      `Midnight Creative is a bold studio ${'that does things '.repeat(8)}today.`,
    ], 'bold')
    expect(f).toEqual({
      cliches: ['passionate', 'innovative', 'solutions'], promises: ['guarantees'], exclamations: 1, firstPerson: 1, longSentences: 1, toneNamed: ['bold'],
    })
    expect(isClean(f)).toBe(false)
    expect(flagCount(f)).toBe(8)
    expect(problemsOf(f)).toEqual([
      'Remove these marketing words and say plainly what is actually done instead: passionate, innovative, solutions.',
      'Remove these promises or claims: guarantees. State the fact without promising a result.',
      'Remove the exclamation marks.',
      'Write in the third person, using the company name — not we, our or us.',
      'Split the 1 sentence(s) longer than 30 words into short sentences.',
      'Do not call the company bold; show the tone instead of naming it.',
    ])
  })

  it('a voice word the person used is a fact, not the tone being named; plain copy is clean', () => {
    const plain = ['Midnight Creative builds websites for small businesses in Austin. Two technical founders do the work.']
    expect(styleFlags(plain, 'technical', 'Two technical founders do the work themselves')).toMatchObject({ toneNamed: [] })
    expect(styleFlags(plain, 'technical')).toMatchObject({ toneNamed: ['technical'] })
    expect(isClean(styleFlags(plain, 'friendly'))).toBe(true)
    // Word boundaries: "solutionist" or "trusted" alone are not the listed phrases.
    expect(styleFlags(['It is trusted by its customers.'])).toMatchObject({ cliches: [] })
  })

  it('a draft that breaks the rules gets one targeted revision, kept only if it is better', async () => {
    const { ws } = await channel()
    const brief = { audience: 'customers', length: 'short' as const, voice: 'friendly' }
    const input: DraftInput = { documentType: 'company-description', profile: { ...NONE, name: 'Acme' }, answers: [], brief }
    const doc = (p: string) => ({ patch: NONE, document: { title: 'Acme — Company Description', paragraphs: [p] } })

    const better = new Fake(undefined, (i) => (i.revise ? doc('Acme builds websites.') : doc('Acme delivers innovative solutions!')))
    setAssistantProvider(better)
    const fixed = await draftDocument({ workspaceId: ws.id, runId: 'r1' }, input)
    expect(fixed!.document.paragraphs).toEqual(['Acme builds websites.'])
    expect(better.drafts[1]!.revise).toEqual({ previous: { title: 'Acme — Company Description', paragraphs: ['Acme delivers innovative solutions!'] }, problems: expect.arrayContaining([expect.stringMatching(/innovative, solutions/), 'Remove the exclamation marks.']) })
    const logged = await db.assistantCall.findMany({ where: { workspaceId: ws.id }, orderBy: { at: 'asc' } })
    expect(logged.map((c) => [(c.result as any).revision, flagCount((c.result as any).style)])).toEqual([[false, 3], [true, 0]])

    const worse = new Fake(undefined, (i) => (i.revise ? doc('We offer innovative solutions!!') : doc('Acme offers solutions.')))
    setAssistantProvider(worse)
    expect((await draftDocument({ workspaceId: ws.id, runId: 'r2' }, input))!.document.paragraphs).toEqual(['Acme offers solutions.'])

    const clean = new Fake(undefined, () => doc('Acme builds websites.'))
    setAssistantProvider(clean)
    await draftDocument({ workspaceId: ws.id, runId: 'r3' }, input)
    expect(clean.drafts).toHaveLength(1) // nothing to fix, no second call
  })

  it('the drafting prompt carries the writing rules', () => {
    expect(WRITING_RULES).toMatch(/No marketing language/)
    expect(WRITING_RULES).toMatch(/Do not over-promise/)
    expect(WRITING_RULES).toMatch(/No jokes, puns/)
  })
})

describe('OpenAIAssistant (no network)', () => {
  it('sends strict JSON-schema requests and validates/clips the answers', async () => {
    const sent: any[] = []
    const real = globalThis.fetch
    globalThis.fetch = (async (_url: string, init: any) => {
      const body = JSON.parse(init.body)
      sent.push(body)
      const content = body.response_format.json_schema.name === 'company_facts'
        ? { ...NONE, name: '  Acme  ', serviceArea: 'galactic', offerings: ['a', 'A', 'b'] }
        : { profilePatch: NONE, document: { title: 'Acme — Company Description', paragraphs: ['One.', '', 'Two.'] } }
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) }
    }) as any
    try {
      const ai = new OpenAIAssistant({ ...assistantConfig(), apiKey: 'k', model: 'm' })
      const facts = await ai.extract({ text: 'x', known: NONE }, new AbortController().signal)
      expect(facts.facts).toMatchObject({ name: 'Acme', serviceArea: null, offerings: ['a', 'b'] })
      expect(facts.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
      const draft = await ai.draft({ documentType: 'company-description', profile: NONE, answers: [], brief: { audience: 'general', length: 'short', voice: null } }, new AbortController().signal)
      expect(draft.document.paragraphs).toEqual(['One.', 'Two.'])
      expect(sent.map((b) => [b.model, b.response_format.type, b.response_format.json_schema.strict, b.temperature])).toEqual([['m', 'json_schema', true, 0], ['m', 'json_schema', true, 0.3]])
      expect(sent[1].messages[0].content).toContain(WRITING_RULES)
    } finally {
      globalThis.fetch = real
    }
  })
})

describe('architecture: the model returns data, workflow code acts (static)', () => {
  const src = resolve(__dirname, '..')
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []))
  const dir = join(src, 'bots/assistant')

  it('the assistant module imports nothing that can post, publish, create documents or change the profile', () => {
    const forbidden = /from '(\.\.\/)+(services\/(ItemService|ReactionService|RoomService|MuteService|events|StreamHub|roomChanges|DocumentService|DocumentContentService|CompanyProfileService|ChoiceService|WorkspaceHost|actions)|bots\/flows|flows\/)/
    for (const f of files(dir)) expect(readFileSync(f, 'utf8'), f).not.toMatch(forbidden)
  })

  it('it writes only its own log (AssistantCall)', () => {
    for (const f of files(dir)) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/db\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)) expect(m[1], f).toBe('assistantCall')
      expect(text, f).not.toMatch(/\$executeRaw|\$queryRaw/)
    }
  })

  it('only the company-profile workflow calls it', () => {
    for (const f of files(src).filter((f) => !f.includes('__tests__') && !f.startsWith(dir))) {
      if (/assistant\/(calls|provider)'/.test(readFileSync(f, 'utf8'))) expect(f.endsWith('bots/flows/companyProfile.ts'), f).toBe(true)
    }
  })
})
