import { db, Prisma } from '@project/db'
import { humanAuthoredSql } from '../lib/authorship'

type Client = Prisma.TransactionClient | typeof db

// A room's lobby numbers, recomputed from its live HUMAN-AUTHORED items so they can't
// drift and bots never make a room look alive (doc/08 I6):
//   responseCount  — live human items after the opening (first human) one
//   durationMs     — total audio/video time of the live human items
//   lastResponseAt — newest live human item, when it isn't the opening one
// Called inside the same transaction as every write that changes them
// (place, share, delete), and by scripts/recount-rooms.ts for a backfill.
// Returns each room's live human item count.
export async function recountRooms(client: Client, roomIds: string[]) {
  const ids = [...new Set(roomIds)]
  const humanItems = new Map<string, number>()
  if (ids.length === 0) return humanItems
  const rows = await client.$queryRaw<{ roomId: string; items: bigint; lastAt: Date | null; seconds: number | null }[]>`
    SELECT i.roomId AS roomId,
           COUNT(DISTINCT i.id) AS items,
           MAX(i.createdAt) AS lastAt,
           SUM(CASE WHEN m.kind IN ('audio', 'video') THEN m.duration END) AS seconds
    FROM Item i
    LEFT JOIN Media m ON m.messageId = i.messageId
    WHERE i.roomId IN (${Prisma.join(ids)}) AND i.deletedAt IS NULL AND ${humanAuthoredSql('i')}
    GROUP BY i.roomId`
  const byRoom = new Map(rows.map((r) => [r.roomId, r]))
  for (const id of ids) {
    const r = byRoom.get(id)
    const items = r ? Number(r.items) : 0
    humanItems.set(id, items)
    const responseCount = Math.max(items - 1, 0)
    await client.room.update({
      where: { id },
      data: {
        responseCount,
        durationMs: Math.round(Number(r?.seconds ?? 0) * 1000),
        lastResponseAt: responseCount > 0 ? r!.lastAt : null,
      },
    })
  }
  return humanItems
}
