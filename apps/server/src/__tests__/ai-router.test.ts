// Phase 2 slice 1 (doc/08): AI router in shadow mode. Off by default; when on, it is
// logged beside the deterministic routing and never changes what bots do.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId, testOtherUserId, seedRoom, seedItem } from './helpers'
import { BotRuntime } from '../bots/runtime'
import { loadPacks } from '../bots/pack'
import { roomPresence } from '../services/presence'
import { ItemService } from '../services/ItemService'
import { resetShadowCaps } from '../bots/ai/shadow'
import { classify } from '../bots/classify'
import { routeStats } from '../plugins/devBots'
import { OpenAIRouter, setRouterProvider, validate, type RouterInput, type RouterOutput, type RouterProvider } from '../bots/ai/router'

const app = buildTestApp()
let rt: BotRuntime
const calls: RouterInput[] = []
const fake = (answer: (input: RouterInput, signal: AbortSignal) => Promise<RouterOutput> | RouterOutput): RouterProvider => ({
  name: 'fake', model: 'fake-1',
  route: async (input, signal) => { calls.push(input); return answer(input, signal) },
})
const ENV = ['AI_ROUTER_MENTION_SAMPLE', 'AI_ROUTER_SHADOW_TIMEOUT_MS', 'AI_ROUTER_SAMPLE', 'AI_ROUTER_ROOM_MAX', 'AI_ROUTER_TIMEOUT_MS', 'AI_ROUTER', 'OPENAI_API_KEY', 'OPENAI_ROUTER_MODEL']

beforeEach(async () => {
  calls.length = 0
  resetShadowCaps()
  process.env.AI_ROUTER_MENTION_SAMPLE = '1' // mentions are a 10% control by default
  rt = await new BotRuntime({ packs: loadPacks(), timeScale: 0.02 }).start()
})
afterEach(async () => {
  await rt.stop()
  roomPresence.reset()
  setRouterProvider(undefined)
  for (const k of ENV) delete process.env[k]
  vi.unstubAllGlobals()
})

async function liveRoom() {
  const room = await seedRoom(app, testUserId)
  await seedItem(app, testUserId, room.id, { text: 'opening post' })
  await rt.idle()
  return room
}
const botReplies = (roomId: string) => db.item.count({ where: { roomId, parentId: { not: null }, message: { author: { kind: 'bot' } } } })

describe('AI router — shadow mode', () => {
  it('is off by default: nothing is called, nothing logged', async () => {
    const room = await liveRoom()
    await seedItem(app, testOtherUserId, room.id, { text: 'hey chatbot', chat: true })
    await rt.idle()
    expect(await db.botRoute.count()).toBe(0)
    expect(await botReplies(room.id)).toBe(1) // deterministic system runs the product
  })

  it('logs agreement beside the deterministic routing; behaviour unchanged', async () => {
    setRouterProvider(fake(() => ({ agent: 'chatbot', intent: 'greeting', confidence: 0.9, shouldRespond: true })))
    const room = await liveRoom()
    const item = await seedItem(app, testOtherUserId, room.id, { text: 'hey chatbot!', chat: true })
    await rt.idle()
    const [route] = await db.botRoute.findMany({ where: { itemId: item.id } })
    expect(route).toMatchObject({ mode: 'shadow', provider: 'fake', model: 'fake-1', reason: 'mentioned', agree: true, error: null })
    expect(await db.botRoute.count({ where: { cold: true } })).toBe(1) // only the process's first call
    expect(route!.deterministic).toMatchObject({ agent: 'chatbot', shouldRespond: true })
    expect(await botReplies(room.id)).toBe(1)
  })

  it('logs disagreement — and still does exactly what the deterministic system decided', async () => {
    setRouterProvider(fake(() => ({ agent: null, intent: 'smalltalk', confidence: 0.4, shouldRespond: false })))
    const room = await liveRoom()
    const item = await seedItem(app, testOtherUserId, room.id, { text: 'chatbot lol', chat: true })
    await rt.idle()
    const [route] = await db.botRoute.findMany({ where: { itemId: item.id } })
    expect(route).toMatchObject({ agree: false, ai: { agent: null, shouldRespond: false } })
    expect(await botReplies(room.id)).toBe(1)
  })

  it('a slow provider times out (logged), never delaying the bot', async () => {
    process.env.AI_ROUTER_SHADOW_TIMEOUT_MS = '50'
    setRouterProvider(fake((_, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))))
    const room = await liveRoom()
    const item = await seedItem(app, testOtherUserId, room.id, { text: 'chatbot?', chat: true })
    await rt.idle()
    const [route] = await db.botRoute.findMany({ where: { itemId: item.id } })
    expect(route).toMatchObject({ error: 'timeout', agree: null })
    expect(route!.latencyMs!).toBeLessThan(1000)
    expect(await botReplies(room.id)).toBe(1)
  })

  it('prefilter: unmentioned messages only when sampled; per-room cap; bot messages never', async () => {
    setRouterProvider(fake(() => ({ agent: null, intent: 'other', confidence: 0.5, shouldRespond: false })))
    process.env.AI_ROUTER_SAMPLE = '0'
    const room = await liveRoom() // the opening post is unmentioned → not routed
    await seedItem(app, testOtherUserId, room.id, { text: 'just us humans', chat: true })
    await rt.idle()
    expect(await db.botRoute.count()).toBe(0)
    process.env.AI_ROUTER_SAMPLE = '1'
    await seedItem(app, testOtherUserId, room.id, { text: 'still just us', chat: true })
    await rt.idle()
    expect((await db.botRoute.findMany()).map((r) => r.reason)).toEqual(['unmentioned'])
    process.env.AI_ROUTER_ROOM_MAX = '2'
    for (let i = 0; i < 3; i++) await seedItem(app, testOtherUserId, room.id, { text: `chatbot ${i}`, chat: true })
    await rt.idle()
    expect(await db.botRoute.count()).toBe(2)
    process.env.AI_ROUTER_SAMPLE = '0'
    const fresh = await liveRoom()
    const before = calls.length
    await new ItemService().send(rt.seeded.find((b) => b.pack.handle === 'chatbot')!.userId, fresh.id, { text: 'bot talking about chatbot', chat: true })
    await rt.idle()
    expect(calls.length).toBe(before)
  })

  it('sends compact context: seated bots only, truncated recent items, BOT marked', async () => {
    setRouterProvider(fake(() => ({ agent: 'chatbot', intent: 'question', confidence: 0.8, shouldRespond: true })))
    const room = await liveRoom()
    for (let i = 0; i < 8; i++) await seedItem(app, testOtherUserId, room.id, { text: `${'x'.repeat(300)} ${i}`, chat: true })
    await seedItem(app, testOtherUserId, room.id, { text: 'chatbot, what is this room for?', chat: true })
    await rt.idle()
    const input = calls.at(-1)!
    expect(input.bots.map((b) => b.handle)).toEqual(['chatbot'])
    expect(input.message).toMatchObject({ author: 'Guest BOB', surface: 'chat' })
    expect(input.recent.length).toBeLessThanOrEqual(6)
    expect(input.recent.every((r) => r.text.length <= 200)).toBe(true)
  })
})

describe('OpenAIRouter', () => {
  it('posts a strict JSON-schema request and validates the answer (no network)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ agent: 'chatbot', intent: 'help', confidence: 0.7, shouldRespond: true }) } }] })))
    vi.stubGlobal('fetch', fetchMock)
    const router = new OpenAIRouter({ mode: 'shadow', apiKey: 'sk-test', model: 'some-model', baseUrl: 'https://api.example/v1', shadowTimeoutMs: 1000, liveTimeoutMs: 1000, sample: 0, mentionSample: 0, perRoomPer10Min: 1, perDay: 1 })
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

  it('is not used unless AI_ROUTER=shadow with a key and a model', async () => {
    const { routerProvider } = await import('../bots/ai/router')
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.OPENAI_ROUTER_MODEL = 'm'
    expect(routerProvider()).toBeNull()
    process.env.AI_ROUTER = 'shadow'
    expect(routerProvider()?.name).toBe('openai')
    delete process.env.OPENAI_ROUTER_MODEL
    expect(routerProvider()).toBeNull()
  })
})

describe('selective routing + taxonomy', () => {
  it('explicit mentions are only a control sample by default; unmentioned requests are routed', async () => {
    delete process.env.AI_ROUTER_MENTION_SAMPLE // default 0.1
    setRouterProvider(fake(() => ({ agent: 'chatbot', intent: 'help', confidence: 0.8, shouldRespond: true })))
    const room = await liveRoom()
    const mentions = []
    for (let i = 0; i < 10; i++) mentions.push(await seedItem(app, testOtherUserId, room.id, { text: `chatbot ping ${i}`, chat: true }))
    const ask = await seedItem(app, testOtherUserId, room.id, { text: 'why does my upload fail with a 413?', chat: true })
    await rt.idle()
    const rows = await db.botRoute.findMany()
    expect(rows.filter((r) => r.reason === 'mentioned').length).toBeLessThanOrEqual(4)
    expect(rows.some((r) => r.itemId === ask.id && r.reason === 'unmentioned')).toBe(true)
  })

  it('"give me a tagline" is a task, not a media request — deterministic and router alike', () => {
    const pack = loadPacks().find((p) => p.handle === 'marketing')!
    const intents = classify('marketing chatbot give me a tagline', pack.classifier).intents.map((i) => i.intent)
    expect(intents).toContain('task')
    expect(intents).not.toContain('media-request')
    expect(validate({ agent: 'marketing', intent: 'task', confidence: 0.9, shouldRespond: true }, ['marketing']).intent).toBe('task')
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

