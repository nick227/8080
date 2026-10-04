// Generated from openapi.yaml — fill in seeds and assertions.
// SSE bodies can't be Ajv-validated via inject; this uses a real socket instead.
import { describe, it, expect } from 'vitest'
import http from 'http'
import { db } from '@project/db'
import { recordChange } from '../services/roomChanges'
import { ItemService } from '../services/ItemService'
import { buildTestApp, asAuth, testUserId, testOtherUserId, seedRoom, seedItem } from './helpers'

const app = buildTestApp()

function openStream(port: number, roomId: string, userId: string, cursor?: string, lastEventId?: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; next: (event: string) => Promise<any>; close: () => void }>(
    (resolve, reject) => {
      const req = http.get(
        { port, path: `/rooms/${roomId}/stream${cursor === undefined ? "" : `?cursor=${cursor}`}`, headers: { ...asAuth(userId), ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}), Origin: 'http://localhost:5173' } },
        (res) => {
          let buffer = ''
          const queued: Array<{ event: string; value: any }> = []
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
              if (event && data) {
                const value = { ...JSON.parse(data), id: /^id: (.+)$/m.exec(frame)?.[1] }
                if (w !== -1) waiters.splice(w, 1)[0]!.resolve(value)
                else queued.push({ event, value })
              }
            }
          })
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            next: (event) => new Promise((r) => {
              const at = queued.findIndex(entry => entry.event === event)
              if (at >= 0) r(queued.splice(at, 1)[0]!.value)
              else waiters.push({ event, resolve: r })
            }),
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
      expect(ev).toMatchObject({ type: 'item.created', actorId: testUserId, id: String(item.number), itemId: item.id, itemNumber: item.number })

      const updated = stream.next('item.updated')
      await app.inject({ method: 'PUT', url: `/items/${item.id}/reactions/like`, headers: asAuth(testUserId) })
      const up = await updated
      expect(up.itemId).toBe(item.id)
      expect(up.actorId).toBe(testUserId)
      expect(ev.item.message.text).toBe('live')
      expect(up.cursor).toBe('2')
      expect(up.item.reactions).toEqual([{ type: 'like', count: 1, reacted: false }])
    } finally {
      stream.close()
    }
  })
})


describe('durable room recovery', () => {
  it('replays offline creates, reactions, removals and tombstones with viewer state', async () => {
    if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as any).port
    const room = await seedRoom(app, testUserId)
    const first = await seedItem(app, testUserId, room.id, { text: 'first' })
    const page = await app.inject({ method: 'GET', url: `/rooms/${room.id}/items?order=desc`, headers: asAuth(testUserId) })
    expect(page.json().meta.changeCursor).toBe('1')
    const second = await seedItem(app, testUserId, room.id, { text: 'second' })
    await app.inject({ method: 'PUT', url: `/items/${second.id}/reactions/like`, headers: asAuth(testUserId) })
    await app.inject({ method: 'PUT', url: `/items/${second.id}/reactions/laugh`, headers: asAuth(testUserId) })
    await app.inject({ method: 'DELETE', url: `/items/${second.id}/reactions/laugh`, headers: asAuth(testUserId) })
    await app.inject({ method: 'DELETE', url: `/items/${first.id}`, headers: asAuth(testUserId) })
    // Nothing was subscribed during these writes. Last-Event-ID overrides the URL.
    const stream = await openStream(port, room.id, testUserId, '0', '1')
    try {
      const created = await stream.next('item.created')
      expect(created.cursor).toBe('2')
      expect(created.item.id).toBe(second.id)
      expect(created.item.reactions).toEqual([{ type: 'like', count: 1, reacted: true }])
      for (const cursor of ['3', '4', '5']) expect((await stream.next('item.updated')).cursor).toBe(cursor)
      const deleted = await stream.next('item.updated')
      expect(deleted.cursor).toBe('6')
      expect(deleted.item.deletedAt).not.toBeNull()
      expect(deleted.item.message.text).toBeNull()
    } finally { stream.close() }
  })

  it('drains recovery across the 100-change batch boundary', async () => {
    if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as any).port
    const room = await seedRoom(app, testUserId)
    const item = await seedItem(app, testUserId, room.id, { text: 'batch' })
    await db.$transaction(async tx => {
      for (let i = 0; i < 101; i++) await recordChange(tx, room.id, item.id, testUserId)
    })
    const stream = await openStream(port, room.id, testUserId, '1')
    try {
      for (let sequence = 2; sequence <= 102; sequence++) {
        const event = await stream.next('item.updated')
        expect(event.cursor).toBe(String(sequence))
        expect(event.item.id).toBe(item.id)
      }
    } finally { stream.close() }
  })

  it('rolls the journal back with a failed write', async () => {
    const room = await seedRoom(app, testUserId)
    await expect(new ItemService().send(testUserId, room.id, { text: 'rollback' }, {
      onPlaced: async () => { throw new Error('abort') },
    })).rejects.toThrow('abort')
    expect(await db.roomChange.count({ where: { roomId: room.id } })).toBe(0)
    expect((await db.room.findUniqueOrThrow({ where: { id: room.id } })).changeCount).toBe(0)
  })

  it('rejects malformed and future cursors before opening the stream', async () => {
    const room = await seedRoom(app, testUserId)
    for (const cursor of ['-1', 'wat', '999999999999999999999', '1']) {
      const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/stream?cursor=${cursor}`, headers: asAuth(testUserId) })
      expect(res.statusCode).toBe(400)
    }
  })
})
