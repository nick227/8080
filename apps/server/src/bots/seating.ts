// Seating is what authorizes a bot to act in a room (doc/08 I1). No RoomBot row means
// the bot's default: house → seated, optional → not seated.
import { db, type Prisma } from '@project/db'

type Client = Prisma.TransactionClient | typeof db
export type BotRef = { id: string; kind: 'house' | 'optional'; enabled: boolean }

export async function isSeated(bot: BotRef, roomId: string, client: Client = db) {
  if (!bot.enabled) return false
  const row = await client.roomBot.findUnique({ where: { roomId_botId: { roomId, botId: bot.id } }, select: { state: true } })
  if (row) return row.state === 'seated'
  return bot.kind === 'house'
}

/** Enabled bots seated in the room, with their user + profile. */
export async function seatedBots(roomId: string, client: Client = db) {
  const bots = await client.bot.findMany({
    where: { enabled: true },
    include: { user: { include: { profile: true } }, rooms: { where: { roomId }, select: { state: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return bots.filter((bot) => {
    const row = bot.rooms[0]
    return row ? row.state === 'seated' : bot.kind === 'house'
  })
}
