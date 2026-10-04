// Bot runtime (doc/08 Phase 1a): greet, burst, cooldown across restart, summon on the
// summoner's surface, variety, loop guard, kill switch, once-ever opening line,
// exact replay, pack validation. Runs the real chatbot pack with compressed time.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, cpSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { db } from '@project/db'
import { buildTestApp, asAuth, testUserId, testOtherUserId, seedRoom, seedItem } from './helpers'
import { BotRuntime, replayChoice, fill, joinNames } from '../bots/runtime'
import { loadPack, loadPacks, PACKS_DIR } from '../bots/pack'
import { mentionedBots, classify } from '../bots/classify'
import { BOT_LIMITS } from '../bots/limits'
import { roomPresence } from '../services/presence'

const app = buildTestApp()
let rt: BotRuntime
const start = () => new BotRuntime({ packs: loadPacks(), timeScale: 0.02 }).start()
const bot = () => rt.seeded.find((b) => b.pack.handle === 'chatbot')!

beforeEach(async () => {
  rt = await start()
})
afterEach(async () => {
  await rt.stop()
  roomPresence.reset()
  delete process.env.BOTS
  delete process.env.PRESENCE_GRACE_MS
})

const botItems = (roomId: string) =>
  db.item.findMany({ where: { roomId, message: { authorId: bot().userId } }, include: { message: true }, orderBy: { number: 'asc' } })
const decisions = (roomId: string, workflow?: string) =>
  db.botDecision.findMany({ where: { roomId, ...(workflow ? { workflow } : {}) }, orderBy: { at: 'asc' } })

async function liveRoom() {
  const room = await seedRoom(app, testUserId)
  await seedItem(app, testUserId, room.id, { text: 'opening post' })
  await rt.idle() // the creator's opening line
  return room
}

describe('greet', () => {
  it('greets a new person by name, in chat, after they arrive', async () => {
    const room = await liveRoom()
    roomPresence.connect(room.id, testOtherUserId)
    await rt.idle()
    const [greet] = await decisions(room.id, 'greet')
    expect(greet).toMatchObject({ skippedReason: null, subjects: [testOtherUserId] })
    const item = await db.item.findUniqueOrThrow({ where: { id: greet!.itemId! }, include: { message: true } })
    expect(item.chat).toBe(true)
    expect(item.message.text).toContain('Guest BOB')
    expect(item.message.authorId).toBe(bot().userId)
    // The bot's own lines say "chatbot" — they must never summon it (loop guard).
    expect(await decisions(room.id, 'answerSummon')).toHaveLength(0)
  })

  it('a burst of arrivals gets one combined greeting', async () => {
    const room = await liveRoom()
    const carol = await db.user.create({ data: { profile: { create: { displayName: 'Carol' } } } })
    roomPresence.connect(room.id, testOtherUserId)
    roomPresence.connect(room.id, carol.id)
    await rt.idle()
    const greets = (await decisions(room.id, 'greet')).filter((d) => d.itemId)
    expect(greets).toHaveLength(1)
    expect(greets[0]!.subjects).toEqual(expect.arrayContaining([testOtherUserId, carol.id]))
    const item = await db.item.findUniqueOrThrow({ where: { id: greets[0]!.itemId! }, include: { message: true } })
    expect(item.message.text).toMatch(/Guest BOB and Carol|Carol and Guest BOB/)
  })

  it('no re-greet within the cooldown — not on refresh, re-arrival, or server restart', async () => {
    process.env.PRESENCE_GRACE_MS = '10'
    const room = await liveRoom()
    const leave = roomPresence.connect(room.id, testOtherUserId)
    await rt.idle()
    leave()
    await new Promise((r) => setTimeout(r, 30)) // gone past grace
    roomPresence.connect(room.id, testOtherUserId) // re-arrival
    await rt.idle()
    await rt.stop()
    roomPresence.reset()
    rt = await start() // "restart": in-memory state gone, decision log persists
    roomPresence.connect(room.id, testOtherUserId)
    await rt.idle()
    const greets = await decisions(room.id, 'greet')
    expect(greets.map((d) => d.skippedReason)).toEqual([null, 'recently-greeted', 'recently-greeted'])
  })

  it('the owner arriving after their opening line is not greeted again', async () => {
    const room = await liveRoom()
    roomPresence.connect(room.id, testUserId)
    await rt.idle()
    expect((await decisions(room.id, 'greet')).map((d) => d.skippedReason)).toEqual(['recently-greeted'])
  })

  it('never posts into a room with no human item', async () => {
    const room = await seedRoom(app, testUserId)
    roomPresence.connect(room.id, testOtherUserId)
    await rt.idle()
    expect((await decisions(room.id, 'greet')).map((d) => d.skippedReason)).toEqual(['no-human-item'])
    expect(await botItems(room.id)).toHaveLength(0)
  })
})

describe('summon', () => {
  it('answers in chat when summoned from chat, on stage when summoned from stage', async () => {
    const room = await liveRoom()
    const inChat = await seedItem(app, testOtherUserId, room.id, { text: 'hey chatbot what is up', chat: true })
    await rt.idle()
    const onStage = await seedItem(app, testOtherUserId, room.id, { text: 'Chatbot, can you help me?' })
    await rt.idle()
    const replies = (await botItems(room.id)).filter((i) => i.parentId)
    expect(replies.map((i) => [i.parentId, i.chat])).toEqual([[inChat.id, true], [onStage.id, false]])
    expect(replies[0]!.message.text).toContain('Guest BOB')
    const [d1, d2] = await decisions(room.id, 'answerSummon')
    expect((d1!.inputs as any).intents.map((i: any) => i.intent)).toContain('greeting')
    expect((d2!.inputs as any).intents.map((i: any) => i.intent)).toContain('help')
  })

  it('varies its answers: the same message never gets the same line back to back', async () => {
    const saved = BOT_LIMITS.roomCap
    BOT_LIMITS.roomCap = 100
    try {
      const room = await liveRoom()
      for (let i = 0; i < 6; i++) {
        await seedItem(app, testOtherUserId, room.id, { text: 'hey chatbot', chat: true })
        await rt.idle()
      }
      const chosen = (await decisions(room.id, 'answerSummon')).map((d) => d.chosen)
      expect(chosen.every(Boolean)).toBe(true)
      for (let i = 1; i < chosen.length; i++) expect(chosen[i]).not.toBe(chosen[i - 1])
    } finally {
      BOT_LIMITS.roomCap = saved
    }
  })

  it('only the word summons it; @chatbot works; "chatbots" does not', async () => {
    const room = await liveRoom()
    await seedItem(app, testOtherUserId, room.id, { text: 'chatbots are a fad', chat: true })
    await seedItem(app, testOtherUserId, room.id, { text: 'nobody here', chat: true })
    await rt.idle()
    expect(await decisions(room.id, 'answerSummon')).toHaveLength(0)
    await seedItem(app, testOtherUserId, room.id, { text: 'thanks @chatbot!', chat: true })
    await rt.idle()
    expect(await decisions(room.id, 'answerSummon')).toHaveLength(1)
  })

  it('a kicked bot does not answer', async () => {
    const room = await liveRoom()
    await db.roomBot.create({ data: { roomId: room.id, botId: bot().botId, state: 'kicked' } })
    await seedItem(app, testOtherUserId, room.id, { text: 'chatbot?', chat: true })
    await rt.idle()
    expect((await botItems(room.id)).filter((i) => i.parentId)).toHaveLength(0)
  })

  it('BOTS=off: nothing is posted, and the log says why', async () => {
    const room = await liveRoom()
    const before = (await botItems(room.id)).length
    process.env.BOTS = 'off'
    await seedItem(app, testOtherUserId, room.id, { text: 'chatbot hello', chat: true })
    await rt.idle()
    expect(await botItems(room.id)).toHaveLength(before)
    expect((await decisions(room.id, 'answerSummon')).map((d) => d.skippedReason)).toEqual(['bots-off'])
  })
})

describe('opening line (R9b)', () => {
  it('once per room, after the owner’s first post — survives restart and a deleted first item', async () => {
    const room = await seedRoom(app, testUserId)
    const first = await seedItem(app, testUserId, room.id, { text: 'kicking this off' })
    await rt.idle()
    let items = await botItems(room.id)
    expect(items).toHaveLength(1)
    expect(items[0]!.number).toBe(2) // the human opening piece stays #1
    expect(items[0]!.message.text).toBeTruthy()
    await rt.stop()
    rt = await start()
    await app.inject({ method: 'DELETE', url: `/items/${first.id}`, headers: asAuth(testUserId) })
    await seedItem(app, testUserId, room.id, { text: 'again, first live human item' })
    await rt.idle()
    items = await botItems(room.id)
    expect(items).toHaveLength(1)
    expect(await db.botOnce.findMany({ where: { roomId: room.id } })).toMatchObject([{ key: `opening:${room.id}`, outcome: 'posted' }])
  })

  it('if someone other than the owner posts first: no opening line, ever (recorded as skipped)', async () => {
    const room = await seedRoom(app, testUserId)
    await seedItem(app, testOtherUserId, room.id, { text: 'I got here first' })
    await rt.idle()
    await seedItem(app, testUserId, room.id, { text: 'owner arrives' })
    await rt.idle()
    expect(await botItems(room.id)).toHaveLength(0)
    expect(await db.botOnce.findMany({ where: { roomId: room.id } })).toMatchObject([{ outcome: 'skipped', reason: 'first-item-not-owner' }])
  })
})

describe('decision log', () => {
  it('exact replay reproduces the choice, even after usage history moved on', async () => {
    const room = await liveRoom()
    await seedItem(app, testOtherUserId, room.id, { text: 'chatbot how are you?', chat: true })
    await rt.idle()
    const [first] = await decisions(room.id, 'answerSummon')
    expect(first!.candidates).not.toHaveLength(0)
    expect(replayChoice(first!)).toBe(first!.chosen)
    for (let i = 0; i < 3; i++) {
      await seedItem(app, testOtherUserId, room.id, { text: 'chatbot how are you?', chat: true })
      await rt.idle()
    }
    const again = await db.botDecision.findUniqueOrThrow({ where: { id: first!.id } })
    expect(replayChoice(again)).toBe(first!.chosen)
    expect(again).toMatchObject({ packVersion: bot().pack.version, classifierVersion: 'c1' })
    expect((again.filtered as any[]).every((f) => typeof f.reason === 'string')).toBe(true)
  })
})

describe('pack + helpers', () => {
  it('the shipped chatbot pack loads and validates', () => {
    const pack = loadPack(join(PACKS_DIR, 'chatbot'))
    expect(pack.workflows.map((w) => w.id)).toEqual(['greet', 'opening', 'answerSummon', 'idleNudge'])
    expect(pack.version).toMatch(/^[0-9a-f]{12}$/)
  })

  it('an unknown guard fails loudly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-'))
    cpSync(join(PACKS_DIR, 'chatbot'), dir, { recursive: true })
    writeFileSync(join(dir, 'workflows.yaml'), readFileSync(join(dir, 'workflows.yaml'), 'utf8').replace('itemLive', 'teleport'))
    expect(() => loadPack(dir)).toThrow(/unknown guard "teleport"/)
  })

  it('mentions: longest alias wins and consumes its span', () => {
    const bots = [{ id: 'house', aliases: ['chatbot'] }, { id: 'mkt', aliases: ['marketing chatbot', 'marketing'] }]
    expect([...mentionedBots('hey marketing chatbot', bots)]).toEqual(['mkt'])
    expect([...mentionedBots('chatbot and marketing chatbot', bots)].sort()).toEqual(['house', 'mkt'])
    expect([...mentionedBots('CHATBOT!', bots)]).toEqual(['house'])
  })

  it('classifier, slots and names', () => {
    const pack = loadPack(join(PACKS_DIR, 'chatbot'))
    expect(classify('thanks chatbot', pack.classifier).intents[0]!.intent).toBe('praise')
    expect(fill('hi {name}', {})).toBeNull()
    expect(fill('hi {name}', { name: 'Ana' })).toBe('hi Ana')
    expect(joinNames(['Ana', 'Raj', 'Lee'])).toBe('Ana, Raj and Lee')
    expect(joinNames(['A', 'B', 'C', 'D'])).toBe('A, B, C and 1 other')
    expect(joinNames(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe('A, B, C and 4 others')
  })
})
