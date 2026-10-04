import { itemInclude } from '../lib/serialize'
import { db, type Prisma } from '@project/db'

export async function recordChange(tx: Prisma.TransactionClient, roomId: string, itemId: string, actorId: string, type = 'item.updated') {
  const room = await tx.room.update({ where: { id: roomId }, data: { changeCount: { increment: 1 } }, select: { changeCount: true } })
  await tx.roomChange.create({ data: { roomId, sequence: room.changeCount, itemId, actorId, type } })
}

async function readBatch(roomId: string, cursor: number) {
  return db.$transaction(async (tx) => {
    const changes = await tx.roomChange.findMany({ where: { roomId, sequence: { gt: cursor } }, orderBy: { sequence: 'asc' }, take: 100 })
    const items = changes.length ? await tx.item.findMany({ where: { id: { in: changes.map(c => c.itemId) } }, include: itemInclude }) : []
    return { changes, items }
  }, { isolationLevel: 'RepeatableRead' })
}

// Viewers at the same cursor share hydration work, including in-flight reads.
// Short-lived entries bound memory and do not retain deleted content in a log.
const batches = new Map<string, ReturnType<typeof readBatch>>()
export function readRoomChanges(roomId: string, cursor: number) {
  const key = `${roomId}:${cursor}`
  const existing = batches.get(key)
  if (existing) return existing
  const batch = readBatch(roomId, cursor)
  batches.set(key, batch)
  const expire = () => { setTimeout(() => { if (batches.get(key) === batch) batches.delete(key) }, 250).unref() }
  void batch.then(expire, expire)
  return batch
}
