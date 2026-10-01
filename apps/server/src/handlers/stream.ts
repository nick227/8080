import { RoomService } from '../services/RoomService'
import { streamHub } from '../services/StreamHub'

const roomService = new RoomService()
const HEARTBEAT_MS = 25_000

export async function streamRoomEvents(request: any, reply: any) {
  const { roomId } = request.params
  await roomService.viewable(request.user.id, roomId)

  // Hijack bypasses onSend hooks, so carry over headers already set (CORS).
  reply.hijack()
  reply.raw.writeHead(200, {
    ...reply.getHeaders(),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  reply.raw.write('retry: 3000\n\n')

  const unsubscribe = streamHub.subscribe(roomId, {
    userId: request.user.id,
    write: (frame) => reply.raw.write(frame),
  })
  const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), HEARTBEAT_MS)

  request.raw.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}
