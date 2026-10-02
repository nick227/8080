// Backfill: recompute every room's lobby numbers (responseCount, durationMs,
// lastResponseAt) from its live items. Safe to re-run.
//   local:   set -a; . ../../.env; set +a; pnpm rooms:recount
//   Railway: railway run pnpm --filter server rooms:recount
import { db } from '@project/db'
import { recountRooms } from '../services/roomStats'

const BATCH = 200

async function main() {
  let cursor: string | undefined
  let total = 0
  for (;;) {
    const rooms = await db.room.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (rooms.length === 0) break
    await recountRooms(db, rooms.map((r) => r.id))
    total += rooms.length
    cursor = rooms[rooms.length - 1]!.id
  }
  console.log(`Recounted ${total} rooms`)
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => db.$disconnect())
