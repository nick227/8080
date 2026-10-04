// doc/08 §4.9 (binding): OpenAI is observational only. The router runs in shadow
// mode on sampled UNMENTIONED human messages in rooms where someone is present,
// logs its recommendation beside the deterministic routing, and never changes
// what bots do. Explicit mentions never call the model. Tests never call real AI.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { db } from '@project/db'
import { buildTestApp, testUserId, testOtherUserId, seedRoom, seedItem } from './helpers'
import { BotRuntime } from '../bots/runtime'
import { loadPacks } from '../bots/pack'
import { roomPresence } from '../services/presence'
import { ItemService } from '../services/ItemService'
import { resetShadowCaps } from '../bots/ai/shadow'
import { routerConfig } from '../bots/ai/config'
import { classify } from '../bots/classify'
import { routeStats } from '../plugins/devBots'
import { OpenAIRouter, setRouterProvider, validate, type RouterInput, type RouterOutput, type RouterProvider, type Usage } from '../bots/ai/router'

const app = buildTestApp()
let rt: BotRuntime
const calls: RouterInput[] = []
const fake = (answer: (input: RouterInput, signal: AbortSignal) => Promise<RouterOutput & { usage?: Usage }> | (RouterOutput & { usage?: Usage })): RouterProvider => ({
  name: 'fake', model: 'fake-1',
  route: async (input, signal) => { calls.push(input); return answer(input, signal) },
})
const none = (): RouterOutput => ({ agent: null, intent: 'other', confidence: 0.5, shouldRespond: false })
const ENV = ['AI_ROUTER_SAMPLE', 'AI_ROUTER_ROOM_MAX', 'AI_ROUTER_TIMEOUT_MS', 'AI_ROUTER_DAILY_USD', 'AI_ROUTER', 'OPENAI_API_KEY', 'OPENAI_ROUTER_MODEL', 'BOTS']

beforeEach(async () => {
  calls.length = 0
  resetShadowCaps()
  rt = await new BotRuntime({ packs: loadPacks(), timeScale: 0.02 }).start()
})
afterEach(async () => {
  await rt.stop()
  roomPresence.reset()
  setRouterProvider(undefined)
  for (const k of ENV) delete process.env[k]
  vi.unstubAllGlobals()
})

/** A room with an opening post and someone present (the router never runs in empty rooms). */
async function liveRoom(present = true) {
  const room = await seedRoom(app, testUserId)
  if (present) roomPresence.connect(room.id, testOtherUserId)
  await seedItem(app, testUserId, room.id, { text: 'opening post' })
  await rt.idle()
  return room
}
const botItems = (roomId: string) => db.item.count({ where: { roomId, message: { author: { kind: 'bot' } } } })

describe('observational only — policy', () => {
  it('off by default: nothing called, nothing logged, product works', async () => {
    const room = await liveRoom()
    await seedItem(app, testOtherUserId, room.id, { text: 'hey chatbot', chat: true })
    await seedItem(app, testOtherUserId, room.id, { text: 'why does my upload fail?', chat: true })
    await rt.idle()
    expect(await db.botRoute.count()).toBe(0)
    expect(await db.item.count({ where: { roomId: room.id, parentId: { not: null }, message: { author: { kind: 'bot' } } } })).toBe(1)
  })

  it('explicit mentions never call the model (deterministic owns them)', async () => {
    setRouterProvider(fake(none))
    const room = await liveRoom()
    calls.length = 0
    for (const text of ['hey chatbot', 'chatbot, help', '@chatbot?']) await seedItem(app, testOtherUserId, room.id, { text, chat: true })
    await rt.idle()
    expect(calls).toHaveLength(0)
    expect(await db.botRoute.count({ where: { reason: 'mentioned' } })).toBe(0)
  })

  it('never in an empty room', async () => {
    setRouterProvider(fake(none))
    const room = await liveRoom(false)
    await seedItem(app, testOtherUserId, room.id, { text: 'is anyone there?', chat: true })
    await rt.idle()
    expect(calls).toHaveLength(0)
  })

  it('a recommendation changes nothing: the router says "technical, respond" — no bot acts', async () => {
    setRouterProvider(fake(() => ({ agent: 'chatbot', intent: 'help', confidence: 0.9, shouldRespond: true, usage: { promptTokens: 400, completionTokens: 30 } })))
    const room = await liveRoom()
    const before = await botItems(room.id)
    const item = await seedItem(app, testOtherUserId, room.id, { text: 'why does my upload fail with a 413?', chat: true })
    await rt.idle()
    expect(await botItems(room.id)).toBe(before)
    const route = await db.botRoute.findFirstOrThrow({ where: { itemId: item.id } })
    // Every request logs trigger, room, input size, model, latency, result, error, cost.
    expect(route).toMatchObject({ mode: 'shadow', trigger: 'item.created', roomId: room.id, provider: 'fake', model: 'fake-1', reason: 'unmentioned', error: null, agree: false, promptTokens: 400, completionTokens: 30 })
    expect(route.inputChars).toBeGreaterThan(0)
    expect(route.latencyMs).not.toBeNull()
    expect(route.costUsd).toBeCloseTo((400 * 0.4 + 30 * 1.6) / 1e6, 12)
    expect(route.ai).toEqual({ agent: 'chatbot', intent: 'help', confidence: 0.9, shouldRespond: true })
    expect(route.deterministic).toMatchObject({ agent: null, shouldRespond: false })
  })

  it('hard caps: per-room, daily spend; bot messages never routed', async () => {
    setRouterProvider(fake(() => ({ ...none(), usage: { promptTokens: 1_000_000, completionTokens: 0 } }))) // $0.40 a call
    process.env.AI_ROUTER_DAILY_USD = '0.5'
    const room = await liveRoom() // opening post → call 1 ($0.40)
    await seedItem(app, testOtherUserId, room.id, { text: 'second', chat: true }) // call 2 ($0.80 total)
    await rt.idle()
    await seedItem(app, testOtherUserId, room.id, { text: 'third', chat: true }) // over budget → skipped
    await rt.idle()
    expect(await db.botRoute.count()).toBe(2)
    delete process.env.AI_ROUTER_DAILY_USD
    await db.botRoute.updateMany({ data: { costUsd: 0 } })
    process.env.AI_ROUTER_ROOM_MAX = '3'
    for (let i = 0; i < 3; i++) await seedItem(app, testOtherUserId, room.id, { text: `more ${i}`, chat: true })
    await rt.idle()
    expect(await db.botRoute.count({ where: { roomId: room.id } })).toBe(3)
    const before = calls.length
    const fresh = await liveRoom()
    const afterOpening = calls.length
    await new ItemService().send(rt.seeded.find((b) => b.pack.handle === 'chatbot')!.userId, fresh.id, { text: 'a bot talking', chat: true })
    await rt.idle()
    expect(afterOpening - before).toBe(1)
    expect(calls.length).toBe(afterOpening)
  })

  it('sampling: AI_ROUTER_SAMPLE=0 routes nothing', async () => {
    setRouterProvider(fake(none))
    process.env.AI_ROUTER_SAMPLE = '0'
    const room = await liveRoom()
    await seedItem(app, testOtherUserId, room.id, { text: 'just us humans', chat: true })
    await rt.idle()
    expect(calls).toHaveLength(0)
  })

  it('a slow provider times out (logged); nothing waits on it', async () => {
    process.env.AI_ROUTER_TIMEOUT_MS = '50'
    setRouterProvider(fake((_, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))))
    const room = await liveRoom()
    const route = await db.botRoute.findFirstOrThrow({ where: { roomId: room.id } })
    expect(route).toMatchObject({ error: 'timeout', agree: null, costUsd: null })
    expect(route.latencyMs!).toBeLessThan(1000)
  })

  it('real provider is never used in tests, with BOTS=off, or without AI_ROUTER=shadow + key + model', async () => {
    const { routerProvider } = await import('../bots/ai/router')
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.OPENAI_ROUTER_MODEL = 'm'
    process.env.AI_ROUTER = 'shadow'
    expect(routerProvider()).toBeNull() // NODE_ENV=test
    const saved = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      expect(routerProvider()?.name).toBe('openai')
      process.env.AI_ROUTER = 'live' // no such mode
      expect(routerProvider()).toBeNull()
      process.env.AI_ROUTER = 'shadow'
      process.env.BOTS = 'off'
      expect(routerProvider()).toBeNull()
      delete process.env.BOTS
      delete process.env.OPENAI_ROUTER_MODEL
      expect(routerProvider()).toBeNull()
    } finally {
      process.env.NODE_ENV = saved
    }
    expect(routerConfig().mode).toBe('off')
  })

  it('sends compact context: seated bots only, ≤6 recent, truncated', async () => {
    setRouterProvider(fake(none))
    const room = await liveRoom()
    for (let i = 0; i < 8; i++) await seedItem(app, testOtherUserId, room.id, { text: `${'x'.repeat(300)} ${i}`, chat: true })
    await rt.idle()
    const input = calls.at(-1)!
    expect(input.bots.map((b) => b.handle)).toEqual(['chatbot'])
    expect(input.message).toMatchObject({ author: 'Guest BOB', surface: 'chat' })
    expect(input.recent.length).toBeLessThanOrEqual(6)
    expect(input.recent.every((r) => r.text.length <= 200)).toBe(true)
  })
})

describe('architecture: AI cannot act (static)', () => {
  const src = resolve(__dirname, '..')
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []))
  const aiDir = join(src, 'bots/ai')

  it('the AI module imports nothing that can post, react, seat, mute or publish', () => {
    const forbidden = /from '(\.\.\/)+(services\/(ItemService|ReactionService|RoomService|MuteService|events|StreamHub|roomChanges)|bots\/(runtime|seed)|\.\.\/runtime|\.\.\/seed)'/
    for (const f of files(aiDir)) expect(readFileSync(f, 'utf8'), f).not.toMatch(forbidden)
  })

  it('the AI module writes only its own log (BotRoute)', () => {
    for (const f of files(aiDir)) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/db\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)) expect(m[1], f).toBe('botRoute')
      expect(text, f).not.toMatch(/\$executeRaw|\$queryRaw/)
    }
  })

  it('only the shadow recorder uses the router; only the runtime calls the recorder', () => {
    for (const f of files(src).filter((f) => !f.includes('__tests__') && !f.startsWith(aiDir))) {
      const text = readFileSync(f, 'utf8')
      expect(text, f).not.toMatch(/ai\/router'/)
      if (/ai\/shadow'/.test(text)) expect(f.endsWith('bots/runtime.ts'), f).toBe(true)
    }
  })
})

describe('taxonomy', () => {
  it('"give me a tagline" is a task, not a media request — deterministic and router alike', () => {
    const pack = loadPacks().find((p) => p.handle === 'marketing')!
    const intents = classify('marketing chatbot give me a tagline', pack.classifier).intents.map((i) => i.intent)
    expect(intents).toContain('task')
    expect(intents).not.toContain('media-request')
    expect(validate({ agent: 'marketing', intent: 'task', confidence: 0.9, shouldRespond: true }, ['marketing']).intent).toBe('task')
  })
})

describe('OpenAIRouter', () => {
  it('posts a strict JSON-schema request and validates the answer (no network)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ agent: 'chatbot', intent: 'help', confidence: 0.7, shouldRespond: true }) } }] })))
    vi.stubGlobal('fetch', fetchMock)
    const router = new OpenAIRouter({ mode: 'shadow', apiKey: 'sk-test', model: 'some-model', baseUrl: 'https://api.example/v1', timeoutMs: 1000, sample: 0, perRoomPer10Min: 1, perDay: 1, dailyUsd: 1, priceInPerM: 0.4, priceOutPerM: 1.6 })
    const out = await router.route({ room: { title: 'R' }, message: { author: 'A', text: 'help chatbot', surface: 'chat' }, recent: [], bots: [{ handle: 'chatbot', name: 'chatbot', persona: '' }] }, new AbortController().signal)
    expect(out).toEqual({ agent: 'chatbot', intent: 'help', confidence: 0.7, shouldRespond: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example/v1/chat/completions')
    expect((init.headers as any).authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('some-model')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.schema.properties.agent.enum).toEqual(['chatbot', null])
  })

  it('validate: unknown bots become null and cannot respond; confidence clamped', () => {
    expect(validate({ agent: 'hacker', intent: 'help', confidence: 7, shouldRespond: true }, ['chatbot'])).toEqual({ agent: null, intent: 'help', confidence: 1, shouldRespond: false })
    expect(validate({ agent: 'chatbot', intent: 'nonsense', confidence: 'x', shouldRespond: 'yes' }, ['chatbot'])).toEqual({ agent: 'chatbot', intent: 'other', confidence: 0, shouldRespond: false })
  })

})


describe('routeStats', () => {
  const row = (o: Partial<any>) => ({ reason: 'unmentioned', error: null, agree: false, latencyMs: 1000, cold: false, ai: { agent: 'technical', shouldRespond: true }, deterministic: { agent: null, shouldRespond: false }, label: null, ...o })
  it('disagreement, handoffs, warm latency, confusion vs labels, deterministic baseline', () => {
    const s = routeStats([
      row({ label: { agent: 'technical', shouldRespond: true }, latencyMs: 1200 }), // right handoff
      row({ ai: { agent: 'buddy', shouldRespond: true }, label: { agent: 'technical', shouldRespond: true }, latencyMs: 1400 }), // wrong bot
      row({ ai: { agent: 'buddy', shouldRespond: true }, label: { agent: null, shouldRespond: false }, latencyMs: 1600 }), // false respond
      row({ ai: { agent: null, shouldRespond: false }, agree: true, label: { agent: 'technical', shouldRespond: true } }), // false none
      row({ cold: true, latencyMs: 5300 }),
      row({ error: 'timeout', ai: null, agree: null, cold: true, latencyMs: 5000 }),
      row({ reason: 'mentioned', agree: true, ai: { agent: 'chatbot', shouldRespond: true }, deterministic: { agent: 'chatbot', shouldRespond: true } }),
    ])
    expect(s.errors).toEqual({ timeout: 1, other: 0 })
    expect(s.unmentioned).toMatchObject({ answered: 5, handoffs: 4, byAgent: { technical: 2, buddy: 2 } })
    expect(s.unmentioned.disagreementRate).toBe(0.8)
    expect(s.mentioned.agreementRate).toBe(1)
    expect(s.latencyMs.warm.n).toBe(5) // cold calls excluded
    expect(s.latencyMs.cold).toMatchObject({ n: 2, timeouts: 1 })
    expect(s.labeled.confusion).toEqual({ respondRespond: 2, respondNone: 1, noneRespond: 1, noneNone: 0 })
    expect(s.labeled.handoffPrecision).toBe(0.333) // 1 right bot of 3 router "respond"s
    expect(s.labeled.deterministic).toEqual({ correct: 1, falseRespond: 0, falseNone: 3 })
  })
})

