// doc/08 Phase 1b: personal mute (server-enforced, incl. live frames), owner seating
// (add / kick-stops-at-once / intro), optional bots and summon routing, library clips
// on stage, idle nudges, dev tools.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'http'
import { db } from '@project/db'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, seedRoom, seedItem } from './helpers'
import { BotRuntime } from '../bots/runtime'
import { loadPacks } from '../bots/pack'
import { roomPresence } from '../services/presence'
import { ItemService } from '../services/ItemService'

process.env.BOTS_DEV = '1' // dev endpoints for this file's app
const app = buildTestApp()
const items = new ItemService()
let rt: BotRuntime
const start = (opts: { idleMs?: number } = {}) => new BotRuntime({ packs: loadPacks(), timeScale: 0.02, ...opts }).start()
const botUser = (handle: string) => rt.seeded.find((b) => b.pack.handle === handle)!.userId

beforeEach(async () => { rt = await start() })
afterEach(async () => { await rt.stop(); roomPresence.reset() })

async function liveRoom() {
  const room = await seedRoom(app, testUserId)
  await seedItem(app, testUserId, room.id, { text: 'opening post' })
  await rt.idle()
  return room
}
const mute = (who: string, target: string) => app.inject({ method: 'PUT', url: `/users/me/mutes/${target}`, headers: asAuth(who) })
const list = async (roomId: string, who: string) =>
  (await app.inject({ method: 'GET', url: `/rooms/${roomId}/items`, headers: asAuth(who) })).json().data as any[]

function openStream(port: number, roomId: string, userId: string) {
  return new Promise<{ next: (event: string) => Promise<any>; close: () => void }>((resolve, reject) => {
    const req = http.get({ port, path: `/rooms/${roomId}/stream`, headers: { ...asAuth(userId), Origin: 'http://localhost:5173' } }, (res) => {
      let buffer = ''
      const queued: { event: string; value: any }[] = []
      const waiters: { event: string; resolve: (v: any) => void }[] = []
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        buffer += chunk
        let i
        while ((i = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, i)
          buffer = buffer.slice(i + 2)
          const event = /^event: (.+)$/m.exec(frame)?.[1]
          const data = /^data: (.+)$/m.exec(frame)?.[1]
          if (!event || !data) continue
          const w = waiters.findIndex((x) => x.event === event)
          if (w !== -1) waiters.splice(w, 1)[0]!.resolve(JSON.parse(data))
          else queued.push({ event, value: JSON.parse(data) })
        }
      })
      resolve({
        next: (event) => new Promise((r) => {
          const at = queued.findIndex((q) => q.event === event)
          if (at >= 0) r(queued.splice(at, 1)[0]!.value)
          else waiters.push({ event, resolve: r })
        }),
        close: () => req.destroy(),
      })
    })
    req.on('error', reject)
  })
}

describe('mute — enforced by the server, generic for any participant', () => {
  it('muted authors arrive content-less in list and get; others unaffected; unmute restores', async () => {
    const room = await liveRoom()
    const theirs = await seedItem(app, testOtherUserId, room.id, { text: 'from bob' })
    const res = await mute(testUserId, testOtherUserId)
    expect(res.statusCode).toBe(200)
    await validateResponse('muteUser', 200, res.json())
    const mutes = await app.inject({ method: 'GET', url: '/users/me/mutes', headers: asAuth(testUserId) })
    await validateResponse('listMutes', 200, mutes.json())
    expect(mutes.json().data.map((u: any) => u.id)).toEqual([testOtherUserId])

    const seen = await list(room.id, testUserId)
    expect(seen.find((i) => i.id === theirs.id).message).toMatchObject({ text: null, media: [] })
    expect(seen.find((i) => i.message.author.id === testUserId).message.text).toBe('opening post')
    const one = await app.inject({ method: 'GET', url: `/items/${theirs.id}`, headers: asAuth(testUserId) })
    expect(one.json().data.message.text).toBeNull()
    // Bob still sees his own item; nobody else is affected.
    expect((await list(room.id, testOtherUserId)).find((i) => i.id === theirs.id).message.text).toBe('from bob')

    await app.inject({ method: 'DELETE', url: `/users/me/mutes/${testOtherUserId}`, headers: asAuth(testUserId) })
    expect((await list(room.id, testUserId)).find((i) => i.id === theirs.id).message.text).toBe('from bob')
  })

  it("a muted person's reactions leave the viewer's counts", async () => {
    const room = await liveRoom()
    const mine = (await list(room.id, testUserId))[0]
    await app.inject({ method: 'PUT', url: `/items/${mine.id}/reactions/like`, headers: asAuth(testOtherUserId) })
    expect((await list(room.id, testUserId))[0].reactions).toEqual([{ type: 'like', count: 1, reacted: false }])
    await mute(testUserId, testOtherUserId)
    expect((await list(room.id, testUserId))[0].reactions).toEqual([])
  })

  it('muting a bot: its live frames reach the muter content-less, others in full', async () => {
    const room = await liveRoom()
    await mute(testUserId, botUser('chatbot'))
    if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as any).port
    const muter = await openStream(port, room.id, testUserId)
    const other = await openStream(port, room.id, testOtherUserId)
    await items.send(botUser('chatbot'), room.id, { text: 'bot says hi', chat: true })
    const [a, b] = await Promise.all([muter.next('item.created'), other.next('item.created')])
    muter.close()
    other.close()
    expect(a.item.message).toMatchObject({ text: null, media: [] })
    expect(b.item.message.text).toBe('bot says hi')
  })

  it('cannot mute yourself; unknown users 404', async () => {
    expect((await mute(testUserId, testUserId)).statusCode).toBe(400)
    expect((await mute(testUserId, 'nobody-here')).statusCode).toBe(404)
  })
})

describe('owner seating', () => {
  const seat = (who: string, roomId: string, userId: string, on = true) =>
    app.inject({ method: on ? 'PUT' : 'DELETE', url: `/rooms/${roomId}/bots/${userId}`, headers: asAuth(who) })

  it('lists every bot with its seat; only the owner may add; an added bot introduces itself', async () => {
    const room = await liveRoom()
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/bots`, headers: asAuth(testOtherUserId) })
    await validateResponse('listRoomBots', 200, res.json())
    const seats = Object.fromEntries(res.json().data.map((b: any) => [b.handle, b.seated]))
    expect(seats).toEqual({ chatbot: true, marketing: false, technical: false, buddy: false })

    expect((await seat(testOtherUserId, room.id, botUser('marketing'))).statusCode).toBe(403)
    const ok = await seat(testUserId, room.id, botUser('marketing'))
    expect(ok.statusCode).toBe(200)
    await validateResponse('seatRoomBot', 200, ok.json())
    await rt.idle()
    const intro = await db.item.findFirst({ where: { roomId: room.id, message: { authorId: botUser('marketing') } }, include: { message: true } })
    expect(intro?.chat).toBe(true)
    expect(intro?.message.text).toMatch(/marketing/i)
    const roster = await app.inject({ method: 'GET', url: `/rooms/${room.id}/participants`, headers: asAuth(testUserId) })
    expect(roster.json().data.some((p: any) => p.user.id === botUser('marketing') && p.role === 'bot')).toBe(true)
  })

  it('a kicked bot stops at once — a summon already waiting is dropped (logged "kicked")', async () => {
    const room = await liveRoom()
    await seedItem(app, testOtherUserId, room.id, { text: 'chatbot are you there?', chat: true })
    await new Promise((r) => setTimeout(r, 5)) // the summon run is now waiting
    expect((await seat(testUserId, room.id, botUser('chatbot'), false)).statusCode).toBe(200)
    await rt.idle()
    const replies = await db.item.count({ where: { roomId: room.id, parentId: { not: null }, message: { authorId: botUser('chatbot') } } })
    expect(replies).toBe(0)
    const d = await db.botDecision.findFirst({ where: { roomId: room.id, workflow: 'answerSummon' } })
    expect(d?.skippedReason).toBe('kicked')
    // The house bot can be seated again.
    await seat(testUserId, room.id, botUser('chatbot'))
    await seedItem(app, testOtherUserId, room.id, { text: 'chatbot, welcome back', chat: true })
    await rt.idle()
    expect(await db.item.count({ where: { roomId: room.id, parentId: { not: null }, message: { authorId: botUser('chatbot') } } })).toBe(1)
  })
})

describe('optional bots — summon routing', () => {
  it('the longest name wins: "marketing chatbot" is not a summon for chatbot', async () => {
    const room = await liveRoom()
    await db.roomBot.create({ data: { roomId: room.id, botId: rt.seeded.find((b) => b.pack.handle === 'marketing')!.botId, state: 'seated' } })
    await seedItem(app, testOtherUserId, room.id, { text: 'hey marketing chatbot, need a hook', chat: true })
    await rt.idle()
    await seedItem(app, testOtherUserId, room.id, { text: 'and you chatbot?', chat: true })
    await rt.idle()
    const replies = await db.item.findMany({ where: { roomId: room.id, parentId: { not: null } }, include: { message: true }, orderBy: { number: 'asc' } })
    expect(replies.map((r) => r.message.authorId)).toEqual([botUser('marketing'), botUser('chatbot')])
  })

  it('an unseated optional bot does not answer', async () => {
    const room = await liveRoom()
    await seedItem(app, testOtherUserId, room.id, { text: '@tech help me', chat: true })
    await rt.idle()
    expect(await db.item.count({ where: { roomId: room.id, parentId: { not: null } } })).toBe(0)
  })
})

describe('library clips on stage', () => {
  it('"chatbot, play a video" stages a clip as a reply — a new Item for the library Message', async () => {
    const room = await liveRoom()
    const ask = await seedItem(app, testOtherUserId, room.id, { text: 'chatbot play me a video', chat: true })
    await rt.idle()
    const staged = await db.item.findFirst({ where: { roomId: room.id, parentId: ask.id }, include: { message: { include: { media: true } } } })
    expect(staged).toMatchObject({ chat: false })
    expect(staged!.message.authorId).toBe(botUser('chatbot'))
    expect(staged!.message.media[0]).toMatchObject({ source: 'youtube', kind: 'video' })
    const asset = await db.botAsset.findFirst({ where: { messageId: staged!.messageId } })
    expect(asset).toBeTruthy()
    // The library Message is reused, never copied.
    expect(await db.message.count({ where: { id: staged!.messageId } })).toBe(1)
  })
})

describe('idle nudge', () => {
  it('fires once per quiet spell while someone is here; never into an empty room', async () => {
    await rt.stop()
    rt = await start({ idleMs: 2000 }) // × timeScale 0.02 → 40ms
    const room = await liveRoom()
    const empty = await seedRoom(app, testUserId)
    await seedItem(app, testUserId, empty.id, { text: 'nobody is watching' })
    roomPresence.connect(room.id, testOtherUserId)
    await new Promise((r) => setTimeout(r, 150))
    await rt.idle()
    const nudges = await db.botDecision.findMany({ where: { roomId: room.id, workflow: 'idleNudge' } })
    expect(nudges).toHaveLength(1)
    expect(nudges[0]!.skippedReason === null || nudges[0]!.skippedReason === 'probability').toBe(true)
    expect(await db.botDecision.count({ where: { roomId: empty.id, workflow: 'idleNudge' } })).toBe(0)
  })
})

describe('dev tools (BOTS_DEV=1)', () => {
  it('dry-run scores without posting; decisions are listed', async () => {
    const { startBots, stopBots } = await import('../bots/runtime')
    await rt.stop()
    rt = await startBots(loadPacks())
    try {
      const room = await liveRoom()
      const before = await db.item.count({ where: { roomId: room.id } })
      const res = await app.inject({ method: 'POST', url: '/dev/bots/dry-run', payload: { handle: 'chatbot', roomId: room.id, text: 'thanks chatbot!' } })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.intents[0].intent).toBe('praise')
      expect(res.json().data.candidates.length).toBeGreaterThan(0)
      expect(await db.item.count({ where: { roomId: room.id } })).toBe(before)
      const bots = await app.inject({ method: 'GET', url: '/dev/bots' })
      expect(bots.json().data.map((b: any) => b.handle).sort()).toEqual(['buddy', 'chatbot', 'marketing', 'technical'])
      const log = await app.inject({ method: 'GET', url: `/dev/bots/decisions?roomId=${room.id}` })
      expect(log.json().data[0]).toMatchObject({ handle: 'chatbot', workflow: 'opening' })
    } finally {
      await stopBots()
    }
  })
})
