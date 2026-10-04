import { readRoomChanges } from '../services/roomChanges'
import { db } from '@project/db'
import { RoomService } from '../services/RoomService'
import { streamHub } from '../services/StreamHub'
import { roomPresence } from '../services/presence'
import { toItem } from '../lib/serialize'
import { mutes } from '../services/MuteService'

const roomService = new RoomService()

export async function streamRoomEvents(request: any, reply: any) {
  const { roomId } = request.params
  await roomService.viewable(request.user.id, roomId)
  const supplied = request.headers['last-event-id'] || request.query?.cursor
  if (supplied !== undefined && !/^(0|[1-9]\d*)$/.test(String(supplied))) {
    throw { statusCode: 400, message: 'Invalid change cursor' }
  }
  const room = await db.room.findUniqueOrThrow({ where: { id: roomId }, select: { changeCount: true } })
  let cursor = supplied === undefined ? room.changeCount : Number(supplied)
  if (!Number.isSafeInteger(cursor) || cursor > room.changeCount) throw { statusCode: 400, message: 'Invalid change cursor' }
  reply.hijack()
  reply.raw.writeHead(200, {
    ...reply.getHeaders(), 'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no',
  })
  reply.raw.write('retry: 3000\n\n')
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const write = (frame: string) => {
    if (closed) return false
    if (!reply.raw.write(frame)) { request.raw.destroy(); return false }
    return true
  }
  const send = async (frame: string): Promise<boolean> => {
    if (closed) return false
    if (reply.raw.write(frame)) return true
    // write(false) accepted the frame. Wait for it to drain rather than dropping
    // large items or replay batches midway through their bytes.
    return new Promise(resolve => {
      const finish = (ok: boolean) => {
        clearTimeout(timeout)
        reply.raw.off('drain', drained)
        reply.raw.off('close', disconnected)
        resolve(ok)
      }
      const drained = () => finish(true)
      const disconnected = () => finish(false)
      const timeout = setTimeout(() => { finish(false); request.raw.destroy() }, 10_000)
      reply.raw.once('drain', drained)
      reply.raw.once('close', disconnected)
    })
  }
  const unsubscribe = streamHub.subscribe(roomId, { userId: request.user.id, write, close: () => request.raw.destroy() })
  const heartbeat = setInterval(() => write(': ping\n\n'), 25_000)
  const leave = roomPresence.connect(roomId, request.user.id)
  request.raw.on('close', () => {
    closed = true
    clearTimeout(timer)
    clearInterval(heartbeat)
    unsubscribe()
    leave()
  })
  // Poll the durable journal, so process restarts and writes on other instances
  // need no special recovery. Hydrate each bounded batch with one item query.
  const pump = async () => {
    try {
      await roomService.viewable(request.user.id, roomId)
      const batch = await readRoomChanges(roomId, cursor)
      // Per-viewer mute (doc/08 I5): a muted author's item goes out in the hidden
      // shape, so no muted content crosses the wire and the cursor still advances.
      const muted = batch.changes.length ? await mutes.mutedBy(request.user.id) : undefined
      for (const change of batch.changes) {
        const row = batch.items.find(i => i.id === change.itemId)
        if (!row) throw new Error('Change journal item missing')
        const event = { type: change.type, actorId: change.actorId, itemId: row.id, itemNumber: row.number, cursor: String(change.sequence), item: toItem(row, request.user.id, muted) }
        if (!await send(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) return
        cursor = change.sequence
      }
      if (!closed) timer = setTimeout(pump, batch.changes.length === 100 ? 0 : 1000)
    } catch (error) {
      request.log.error(error, 'Room change stream failed')
      request.raw.destroy()
    }
  }
  void pump()
}
