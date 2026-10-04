// doc/08 §2.5 invariants I1–I7, exercised through the real services and routes.
import { describe, it, expect, afterEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, seedRoom, seedItem, seedImage, seedBotUser } from './helpers'
import { ItemService } from '../services/ItemService'
import { RoomService } from '../services/RoomService'
import { events } from '../services/events'
import { roomPresence } from '../services/presence'
import { BOT_LIMITS } from '../bots/limits'

const app = buildTestApp()
const items = new ItemService()
const rooms = new RoomService()
const flush = () => new Promise((r) => setImmediate(r))

afterEach(() => roomPresence.reset())

describe('I1 — a seated bot is an authorized participant without a membership row', () => {
  it('posts in a private room; no RoomMember row; memberCount unchanged', async () => {
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    const bot = await seedBotUser()
    const item = await items.send(bot.userId, room.id, { text: 'hello from the house bot', chat: true })
    expect(item.message.author).toMatchObject({ id: bot.userId, kind: 'bot', tag: 'BOT' })
    expect(await db.roomMember.count({ where: { userId: bot.userId } })).toBe(0)
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}`, headers: asAuth(testUserId) })
    expect(res.json().data.memberCount).toBe(1)
  })

  it('a kicked house bot and an unseated optional bot are refused (BOT_NOT_SEATED)', async () => {
    const room = await seedRoom(app, testUserId)
    const house = await seedBotUser()
    await db.roomBot.create({ data: { roomId: room.id, botId: house.botId, state: 'kicked' } })
    await expect(items.send(house.userId, room.id, { text: 'x' })).rejects.toMatchObject({ statusCode: 403, code: 'BOT_NOT_SEATED' })
    const optional = await seedBotUser({ kind: 'optional' })
    await expect(items.send(optional.userId, room.id, { text: 'x' })).rejects.toMatchObject({ code: 'BOT_NOT_SEATED' })
    await db.roomBot.create({ data: { roomId: room.id, botId: optional.botId, state: 'seated' } })
    await expect(items.send(optional.userId, room.id, { text: 'x' })).resolves.toBeTruthy()
  })

  it('authorizeActor is pure; ensureHumanParticipation joins a person and emits member.joined', async () => {
    const room = await seedRoom(app, testUserId)
    const joined: string[] = []
    const off = events.on('member.joined', (e) => { joined.push(e.userId) })
    const { actor, room: row } = await rooms.authorizeActor(testOtherUserId, room.id)
    expect(await db.roomMember.count({ where: { roomId: room.id, userId: testOtherUserId } })).toBe(0)
    await rooms.ensureHumanParticipation(actor, row)
    await rooms.ensureHumanParticipation(actor, row) // idempotent
    await flush()
    off()
    expect(await db.roomMember.count({ where: { roomId: room.id, userId: testOtherUserId } })).toBe(1)
    expect(joined).toEqual([testOtherUserId])
  })

  it('a bot reacting creates no membership', async () => {
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    const item = await seedItem(app, testUserId, room.id)
    const bot = await seedBotUser()
    const { ReactionService } = await import('../services/ReactionService')
    await new ReactionService().add(bot.userId, item.id, 'like')
    expect(await db.reaction.count({ where: { userId: bot.userId } })).toBe(1)
    expect(await db.roomMember.count({ where: { userId: bot.userId } })).toBe(0)
  })
})

describe('I2 — library asset ≠ room occurrence', () => {
  it('placeExisting stages the same Message twice in one room → two Items, one Message', async () => {
    const room = await seedRoom(app, testUserId)
    const bot = await seedBotUser()
    const msg = await db.message.create({ data: { authorId: bot.userId, text: 'library clip' } })
    const a = await items.placeExisting(bot.userId, room.id, msg.id, {})
    const b = await items.placeExisting(bot.userId, room.id, msg.id, { chat: true })
    expect(a.id).not.toBe(b.id)
    expect([a.messageId, b.messageId]).toEqual([msg.id, msg.id])
    expect([a.chat, b.chat]).toEqual([false, true])
    expect(await db.item.count({ where: { roomId: room.id, messageId: msg.id } })).toBe(2)
  })

  it('only the author may place a Message', async () => {
    const room = await seedRoom(app, testUserId)
    const bot = await seedBotUser()
    const theirs = await db.message.create({ data: { authorId: testUserId, text: 'not yours' } })
    await expect(items.placeExisting(bot.userId, room.id, theirs.id, {})).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('I3 — the reply link never decides the surface', () => {
  const reply = (itemId: string, payload: object) =>
    app.inject({ method: 'POST', url: `/items/${itemId}/replies`, headers: asAuth(testOtherUserId), payload })

  it('a chat reply to a stage item stays in chat; a stage reply to a chat item goes to the stage', async () => {
    const room = await seedRoom(app, testUserId)
    const stage = await seedItem(app, testUserId, room.id, { text: 'on stage' })
    const chat = await seedItem(app, testUserId, room.id, { text: 'in chat', chat: true })
    const r1 = await reply(stage.id, { text: 'chat reply', chat: true })
    expect(r1.statusCode).toBe(201)
    await validateResponse('replyToItem', 201, r1.json())
    expect(r1.json().data).toMatchObject({ parentId: stage.id, chat: true })
    expect((await reply(chat.id, { text: 'stage reply' })).json().data).toMatchObject({ parentId: chat.id, chat: false })
  })

  it('anchorStartMs is stage-only (400 with chat: true)', async () => {
    const room = await seedRoom(app, testUserId)
    const stage = await seedItem(app, testUserId, room.id, { text: 'on stage' })
    const res = await reply(stage.id, { text: 'x', chat: true, anchorStartMs: 0 })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('ANCHOR_UNSUPPORTED')
  })
})

describe('I4 — deduplicated presence', () => {
  it('three tabs and a refresh → one arrived; left only after the grace period', async () => {
    process.env.PRESENCE_GRACE_MS = '40'
    const seen: string[] = []
    const offs = [
      events.on('presence.arrived', (e) => { seen.push(`arrived:${e.userId}`) }),
      events.on('presence.left', (e) => { seen.push(`left:${e.userId}`) }),
    ]
    const tabs = [1, 2, 3].map(() => roomPresence.connect('room-p', 'u1'))
    tabs[0]!() // close a tab
    tabs[1]!()
    tabs[2]!() // last one: leaving
    expect(roomPresence.state('room-p', 'u1')).toBe('leaving')
    const again = roomPresence.connect('room-p', 'u1') // refresh inside grace
    expect(roomPresence.state('room-p', 'u1')).toBe('present')
    await new Promise((r) => setTimeout(r, 60))
    again()
    again() // idempotent disconnect
    await new Promise((r) => setTimeout(r, 60))
    await flush()
    offs.forEach((off) => off())
    delete process.env.PRESENCE_GRACE_MS
    expect(seen).toEqual(['arrived:u1', 'left:u1'])
    expect(roomPresence.state('room-p', 'u1')).toBe('absent')
  })

  it('participants: members, present visitors and seated bots in one roster', async () => {
    const room = await seedRoom(app, testUserId)
    const bot = await seedBotUser({ name: 'chatbot' })
    roomPresence.connect(room.id, testOtherUserId) // a visitor who never joined
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/participants`, headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('listRoomParticipants', 200, res.json())
    const rows = res.json().data.map((p: any) => [p.user.id, p.role, p.present, p.user.tag])
    expect(rows).toEqual(expect.arrayContaining([
      [testUserId, 'owner', false, null],
      [testOtherUserId, 'member', true, null],
      [bot.userId, 'bot', true, 'BOT'],
    ]))
    await db.roomBot.create({ data: { roomId: room.id, botId: bot.botId, state: 'kicked' } })
    const after = await app.inject({ method: 'GET', url: `/rooms/${room.id}/participants`, headers: asAuth(testUserId) })
    expect(after.json().data.some((p: any) => p.user.id === bot.userId)).toBe(false)
  })
})

describe('I6 — human activity drives discovery', () => {
  it('bot posts move neither lobby order nor responseCount / lastResponseAt', async () => {
    const room = await seedRoom(app, testUserId)
    await seedItem(app, testUserId, room.id, { text: 'opening' })
    const before = await db.room.findUniqueOrThrow({ where: { id: room.id } })
    const bot = await seedBotUser()
    await new Promise((r) => setTimeout(r, 15))
    await items.send(bot.userId, room.id, { text: 'bot one', chat: true })
    await items.send(bot.userId, room.id, { text: 'bot two' })
    const after = await db.room.findUniqueOrThrow({ where: { id: room.id } })
    expect(after.lastActivityAt.getTime()).toBe(before.lastActivityAt.getTime())
    expect([after.responseCount, after.lastResponseAt]).toEqual([0, null])
    expect(after.itemCount).toBe(3) // bot items are real, numbered items
  })

  it('a bot posting first does not become the opening item; the first human item is flagged', async () => {
    const room = await seedRoom(app, testUserId)
    const bot = await seedBotUser()
    await items.send(bot.userId, room.id, { text: 'early bot' })
    const flags: boolean[] = []
    const off = events.on('item.created', (e) => { if (e.actorKind === 'human') flags.push(e.firstHumanItem) })
    await seedItem(app, testUserId, room.id, { text: 'first human' })
    await seedItem(app, testOtherUserId, room.id, { text: 'second human' })
    await flush()
    off()
    expect(flags).toEqual([true, false])
    const r = await db.room.findUniqueOrThrow({ where: { id: room.id } })
    expect(r.responseCount).toBe(1)
  })

  it('a bot picture never becomes the card fallback', async () => {
    const res0 = await app.inject({ method: 'POST', url: '/rooms', headers: asAuth(testUserId), payload: { title: 'no thumb' } })
    const room = res0.json().data
    const bot = await seedBotUser()
    const img = await seedImage(bot.userId)
    await items.send(bot.userId, room.id, { mediaIds: [img.id] })
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}`, headers: asAuth(testUserId) })
    expect(res.json().data.thumbnail).toBeNull()
  })
})

describe('I7 — disclosure is data', () => {
  it('authors carry kind + tag', async () => {
    const room = await seedRoom(app, testUserId)
    const bot = await seedBotUser({ name: 'chatbot' })
    await seedItem(app, testUserId, room.id, { text: 'human' })
    await items.send(bot.userId, room.id, { text: 'bot' })
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/items`, headers: asAuth(testUserId) })
    await validateResponse('listRoomItems', 200, res.json())
    expect(res.json().data.map((i: any) => [i.message.author.kind, i.message.author.tag])).toEqual([['human', null], ['bot', 'BOT']])
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: asAuth(testUserId) })
    expect(me.json().data).toMatchObject({ kind: 'human', tag: null })
  })
})

describe('room cap — authoritative inside the write transaction', () => {
  it('two bots posting concurrently never exceed the consecutive cap', async () => {
    const room = await seedRoom(app, testUserId)
    await seedItem(app, testUserId, room.id, { text: 'human' })
    const a = await seedBotUser()
    const b = await seedBotUser()
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => items.send((i % 2 ? a : b).userId, room.id, { text: `bot ${i}` })),
    )
    const ok = results.filter((r) => r.status === 'fulfilled').length
    expect(ok).toBe(BOT_LIMITS.maxConsecutive)
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'BOT_CAP' })
  })

  it('the window cap holds across bots even with humans in between', async () => {
    const saved = BOT_LIMITS.maxConsecutive
    BOT_LIMITS.maxConsecutive = 1000
    try {
      const room = await seedRoom(app, testUserId)
      await seedItem(app, testUserId, room.id, { text: 'human' })
      const a = await seedBotUser()
      const b = await seedBotUser()
      const results = await Promise.allSettled(
        Array.from({ length: BOT_LIMITS.roomCap + 4 }, (_, i) => items.send((i % 2 ? a : b).userId, room.id, { text: `bot ${i}` })),
      )
      expect(results.filter((r) => r.status === 'fulfilled').length).toBe(BOT_LIMITS.roomCap)
    } finally {
      BOT_LIMITS.maxConsecutive = saved
    }
  })
})
