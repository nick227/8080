// Parity suite for "human-authored" (doc/08 §4.6): one fixture set through all three
// faces — DTO predicate, Prisma fragment, raw SQL — plus the seams built on them.
// They must agree exactly; a new seam must join this file.
import { describe, it, expect } from 'vitest'
import { db, Prisma } from '@project/db'
import { isHumanAuthored } from '@project/shared'
import { buildTestApp, asAuth, testUserId, testOtherUserId, seedRoom, seedItem, seedReply, seedBotUser } from './helpers'
import { humanAuthoredSql, humanAuthoredWhere } from '../lib/authorship'
import { recountRooms } from '../services/roomStats'
import { ItemService } from '../services/ItemService'

const app = buildTestApp()
const items = new ItemService()

async function fixtures() {
  const room = await seedRoom(app, testUserId)
  const other = await seedRoom(app, testOtherUserId)
  const bot = await seedBotUser()
  const h1 = await seedItem(app, testUserId, room.id, { text: 'human 1' })
  const b1 = await items.send(bot.userId, room.id, { text: 'bot 1', chat: true })
  const bReplyH = await items.reply(bot.userId, h1.id, { text: 'bot reply to human' })
  const hReplyB = await seedReply(app, testOtherUserId, b1.id, { text: 'human reply to bot' })
  const hDead = await seedItem(app, testOtherUserId, room.id, { text: 'human, deleted' })
  const bDead = await items.send(bot.userId, room.id, { text: 'bot, deleted' })
  await app.inject({ method: 'DELETE', url: `/items/${hDead.id}`, headers: asAuth(testOtherUserId) })
  await items.delete(bot.userId, bDead.id)
  // A human Message shared into another room, and a bot library Message placed twice.
  await app.inject({ method: 'POST', url: `/messages/${h1.messageId}/share`, headers: asAuth(testUserId), payload: { roomIds: [other.id] } })
  await seedItem(app, testOtherUserId, other.id, { text: 'human in other room' })
  const library = await db.message.create({ data: { authorId: bot.userId, text: 'library clip' } })
  await items.placeExisting(bot.userId, room.id, library.id, {})
  await items.placeExisting(bot.userId, other.id, library.id, { chat: true })
  return { room, other, bot, expectHuman: new Set([h1.id, hReplyB.id, hDead.id]), botIds: [b1.id, bReplyH.id, bDead.id] }
}

async function dtos(roomId: string) {
  const res = await app.inject({ method: 'GET', url: `/rooms/${roomId}/items`, headers: asAuth(testUserId) })
  return res.json().data as any[]
}

describe('human-authored parity', () => {
  it('DTO predicate, Prisma fragment and raw SQL select the same items', async () => {
    const { room, other } = await fixtures()
    for (const roomId of [room.id, other.id]) {
      const viaDto = new Set((await dtos(roomId)).filter(isHumanAuthored).map((i) => i.id))
      const viaPrisma = new Set((await db.item.findMany({ where: { roomId, ...humanAuthoredWhere }, select: { id: true } })).map((i) => i.id))
      const viaSql = new Set(
        (await db.$queryRaw<{ id: string }[]>`SELECT i.id FROM Item i WHERE i.roomId = ${roomId} AND ${humanAuthoredSql('i')}`).map((r) => r.id),
      )
      expect([...viaPrisma].sort()).toEqual([...viaDto].sort())
      expect([...viaSql].sort()).toEqual([...viaDto].sort())
      expect(viaDto.size).toBeGreaterThan(0)
    }
  })

  it('the fixture partitions exactly as authored (tombstones keep their author)', async () => {
    const { room, expectHuman, botIds } = await fixtures()
    const all = await dtos(room.id)
    const human = new Set(all.filter(isHumanAuthored).map((i) => i.id))
    for (const id of expectHuman) expect(human.has(id)).toBe(true)
    for (const id of botIds) expect(human.has(id)).toBe(false)
  })

  it('seams agree: recountRooms vs in-memory; last human number server vs client', async () => {
    const { room, other } = await fixtures()
    for (const roomId of [room.id, other.id]) {
      const live = (await dtos(roomId)).filter((i) => i.deletedAt === null)
      const humanLive = live.filter(isHumanAuthored)
      const counts = await recountRooms(db, [roomId])
      expect(counts.get(roomId)).toBe(humanLive.length)
      const r = await db.room.findUniqueOrThrow({ where: { id: roomId } })
      expect(r.responseCount).toBe(Math.max(humanLive.length - 1, 0))
      // Client catch-up: the newest human item number (readCursor) vs the server's view.
      const clientLast = Math.max(...humanLive.map((i) => i.number))
      const [serverLast] = await db.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT MAX(i.number) AS n FROM Item i WHERE i.roomId = ${roomId} AND i.deletedAt IS NULL AND ${humanAuthoredSql('i')}`,
      )
      expect(Number(serverLast!.n)).toBe(clientLast)
    }
  })
})
