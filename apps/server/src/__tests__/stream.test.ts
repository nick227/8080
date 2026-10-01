// Generated from openapi.yaml — fill in seeds and assertions.
// SSE bodies can't be Ajv-validated via inject; this uses a real socket instead.
import { describe, it, expect } from 'vitest'
import http from 'http'
import { buildTestApp, asAuth, testUserId, testOtherUserId, seedRoom, seedItem } from './helpers'

const app = buildTestApp()

function openStream(port: number, roomId: string, userId: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; next: (event: string) => Promise<any>; close: () => void }>(
    (resolve, reject) => {
      const req = http.get(
        { port, path: `/rooms/${roomId}/stream`, headers: { ...asAuth(userId), Origin: 'http://localhost:5173' } },
        (res) => {
          let buffer = ''
          const waiters: Array<{ event: string; resolve: (v: any) => void }> = []
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => {
            buffer += chunk
            let idx
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, idx)
              buffer = buffer.slice(idx + 2)
              const event = /^event: (.+)$/m.exec(frame)?.[1]
              const data = /^data: (.+)$/m.exec(frame)?.[1]
              const w = waiters.findIndex((x) => x.event === event)
              if (w !== -1 && data) waiters.splice(w, 1)[0]!.resolve({ ...JSON.parse(data), id: /^id: (.+)$/m.exec(frame)?.[1] })
            }
          })
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            next: (event) => new Promise((r) => waiters.push({ event, resolve: r })),
            close: () => req.destroy(),
          })
        },
      )
      req.on('error', reject)
    },
  )
}

describe('streamRoomEvents', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/rooms/00000000-0000-0000-0000-000000000000/stream' })
    expect(res.statusCode).toBe(401)
  })

  it('404 for private rooms the caller cannot see', async () => {
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/stream`, headers: asAuth(testOtherUserId) })
    expect(res.statusCode).toBe(404)
  })

  it('GET /rooms/{roomId}/stream pushes item.created and item.updated', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as any).port
    const room = await seedRoom(app, testUserId)
    const stream = await openStream(port, room.id, testOtherUserId)
    try {
      expect(stream.status).toBe(200)
      expect(stream.headers['content-type']).toContain('text/event-stream')
      expect(stream.headers['access-control-allow-origin']).toBe('http://localhost:5173')

      const created = stream.next('item.created')
      const item = await seedItem(app, testUserId, room.id, { text: 'live' })
      const ev = await created
      expect(ev).toMatchObject({ type: 'item.created', actorId: testUserId, id: String(item.number) })
      expect(ev.item).toMatchObject({ id: item.id, message: { text: 'live' } })

      const updated = stream.next('item.updated')
      await app.inject({ method: 'PUT', url: `/items/${item.id}/reactions/like`, headers: asAuth(testUserId) })
      const up = await updated
      expect(up.item.reactions).toEqual([{ type: 'like', count: 1, reacted: false }]) // broadcast payload
      expect(up.actorId).toBe(testUserId)
    } finally {
      stream.close()
    }
  })
})
