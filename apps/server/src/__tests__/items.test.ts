// Generated from openapi.yaml — fill in seeds and assertions.
// Run `pnpm test:generate` to add stubs for new routes.
// Item = a Message's placement in one room; send/reply create a new Message each.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, seedRoom, seedItem, seedReply, multipart } from './helpers'

const app = buildTestApp()

describe('listRoomItems', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/rooms/00000000-0000-0000-0000-000000000000/items' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /rooms/{roomId}/items ascending by number, flat with parentId, message hydrated', async () => {
    const room = await seedRoom(app, testUserId)
    const a = await seedItem(app, testUserId, room.id, { text: 'one' })
    await seedReply(app, testOtherUserId, a.id, { text: 'two' })

    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/items`, headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('listRoomItems', 200, res.json())
    const data = res.json().data
    expect(data.map((i: any) => [i.number, i.message.text, i.parentId])).toEqual([
      [1, 'one', null],
      [2, 'two', a.id],
    ])
    expect(data[1].message.author).toMatchObject({ id: testOtherUserId, name: 'Guest BOB' })
    expect(data[0].messageId).toBe(data[0].message.id)
  })

  it('`after` returns only newer items; cursor pages cover everything once', async () => {
    const room = await seedRoom(app, testUserId)
    for (let i = 0; i < 5; i++) await seedItem(app, testUserId, room.id, { text: `m${i}` })

    const after = await app.inject({ method: 'GET', url: `/rooms/${room.id}/items?after=3`, headers: asAuth(testUserId) })
    expect(after.json().data.map((i: any) => i.number)).toEqual([4, 5])

    const numbers: number[] = []
    let cursor: string | null = null
    do {
      const qs: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/items?limit=2${qs}`, headers: asAuth(testUserId) })
      numbers.push(...res.json().data.map((i: any) => i.number))
      cursor = res.json().meta.nextCursor
    } while (cursor)
    expect(numbers).toEqual([1, 2, 3, 4, 5])
  })

  it('404 for a private room the caller is not in', async () => {
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/items`, headers: asAuth(testOtherUserId) })
    expect(res.statusCode).toBe(404)
  })
})

describe('sendMessage', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/rooms/00000000-0000-0000-0000-000000000000/items' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /rooms/{roomId}/items creates a Message and its first Item', async () => {
    const room = await seedRoom(app, testUserId)
    const res = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/items`,
      headers: asAuth(testUserId),
      payload: { text: '  hi  ' },
    })
    expect(res.statusCode).toBe(201)
    await validateResponse('sendMessage', 201, res.json())
    const item = res.json().data
    expect(item).toMatchObject({ number: 1, parentId: null, reactions: [] })
    expect(item.message).toMatchObject({ text: 'hi', author: { id: testUserId }, media: [] })
    expect(await db.message.count()).toBe(1)
  })

  it('rejects unknown fields (no silent parentId / author spoofing)', async () => {
    const room = await seedRoom(app, testUserId)
    const parent = await seedItem(app, testUserId, room.id)
    for (const extra of [{ parentId: parent.id }, { author: { id: 'spoofed' } }]) {
      const res = await app.inject({
        method: 'POST',
        url: `/rooms/${room.id}/items`,
        headers: asAuth(testUserId),
        payload: { text: 'x', ...extra },
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it('numbers items per room and bumps room activity', async () => {
    const r1 = await seedRoom(app, testUserId)
    const r2 = await seedRoom(app, testUserId)
    await seedItem(app, testUserId, r1.id)
    const second = await seedItem(app, testUserId, r1.id)
    const other = await seedItem(app, testUserId, r2.id)
    expect(second.number).toBe(2)
    expect(other.number).toBe(1)

    const room = await app.inject({ method: 'GET', url: `/rooms/${r1.id}`, headers: asAuth(testUserId) })
    expect(room.json().data.itemCount).toBe(2)
  })

  it('assigns unique numbers under concurrent posts', async () => {
    const room = await seedRoom(app, testUserId)
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => seedItem(app, testUserId, room.id, { text: `c${i}` })),
    )
    expect(results.map((r) => r.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('rejects empty items with EMPTY_ITEM and creates nothing', async () => {
    const room = await seedRoom(app, testUserId)
    const res = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/items`,
      headers: asAuth(testUserId),
      payload: { text: '   ' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('EMPTY_ITEM')
    expect(await db.message.count()).toBe(0)
  })

  it('auto-joins public rooms; private rooms stay closed to outsiders', async () => {
    const pub = await seedRoom(app, testUserId)
    await seedItem(app, testOtherUserId, pub.id)
    const room = await app.inject({ method: 'GET', url: `/rooms/${pub.id}`, headers: asAuth(testOtherUserId) })
    expect(room.json().data.role).toBe('member')

    const priv = await seedRoom(app, testUserId, { visibility: 'private' })
    const res = await app.inject({
      method: 'POST',
      url: `/rooms/${priv.id}/items`,
      headers: asAuth(testOtherUserId),
      payload: { text: 'let me in' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('replyToItem', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/items/00000000-0000-0000-0000-000000000000/replies' })
    expect(res.statusCode).toBe(401)
  })

  it("POST /items/{itemId}/replies creates a new Message as a child Item in the parent's room", async () => {
    const room = await seedRoom(app, testUserId)
    const parent = await seedItem(app, testUserId, room.id, { text: 'parent' })
    const res = await app.inject({
      method: 'POST',
      url: `/items/${parent.id}/replies`,
      headers: asAuth(testOtherUserId),
      payload: { text: 'child' },
    })
    expect(res.statusCode).toBe(201)
    await validateResponse('replyToItem', 201, res.json())
    const child = res.json().data
    expect(child).toMatchObject({ roomId: room.id, parentId: parent.id, number: 2 })
    expect(child.messageId).not.toBe(parent.messageId)
    expect(child.message).toMatchObject({ text: 'child', author: { id: testOtherUserId } })
  })

  it('replies cannot jump rooms: room comes from the parent; a roomId in the body is rejected', async () => {
    const home = await seedRoom(app, testUserId, { title: 'Home' })
    const elsewhere = await seedRoom(app, testUserId, { title: 'Elsewhere' })
    const parent = await seedItem(app, testUserId, home.id)

    const smuggled = await app.inject({
      method: 'POST',
      url: `/items/${parent.id}/replies`,
      headers: asAuth(testUserId),
      payload: { text: 'sneaky', roomId: elsewhere.id },
    })
    expect(smuggled.statusCode).toBe(400)

    const ok = await seedReply(app, testUserId, parent.id)
    expect(ok.roomId).toBe(home.id)
    const elsewhereItems = await app.inject({ method: 'GET', url: `/rooms/${elsewhere.id}/items`, headers: asAuth(testUserId) })
    expect(elsewhereItems.json().data).toEqual([])
  })

  it('replying to a shared placement stays in that placement’s room', async () => {
    const a = await seedRoom(app, testUserId, { title: 'A' })
    const b = await seedRoom(app, testUserId, { title: 'B' })
    const original = await seedItem(app, testUserId, a.id, { text: 'shared' })
    const shared = await app.inject({
      method: 'POST',
      url: `/messages/${original.messageId}/share`,
      headers: asAuth(testUserId),
      payload: { roomIds: [b.id] },
    })
    const inB = shared.json().data[0]
    const reply = await seedReply(app, testOtherUserId, inB.id)
    expect(reply).toMatchObject({ roomId: b.id, parentId: inB.id })
  })

  it('404 when the parent is in a private room the caller cannot see', async () => {
    const priv = await seedRoom(app, testUserId, { visibility: 'private' })
    const parent = await seedItem(app, testUserId, priv.id)
    const res = await app.inject({
      method: 'POST',
      url: `/items/${parent.id}/replies`,
      headers: asAuth(testOtherUserId),
      payload: { text: 'hi' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects empty replies with EMPTY_ITEM', async () => {
    const room = await seedRoom(app, testUserId)
    const parent = await seedItem(app, testUserId, room.id)
    const res = await app.inject({
      method: 'POST',
      url: `/items/${parent.id}/replies`,
      headers: asAuth(testUserId),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('EMPTY_ITEM')
  })
})

describe('getItem', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/items/00000000-0000-0000-0000-000000000000' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /items/{itemId}', async () => {
    const room = await seedRoom(app, testUserId)
    const item = await seedItem(app, testUserId, room.id)
    const res = await app.inject({ method: 'GET', url: `/items/${item.id}`, headers: asAuth(testOtherUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('getItem', 200, res.json())
    expect(res.json().data).toMatchObject({ id: item.id, roomId: room.id, messageId: item.messageId })
  })

  it('404 for items in private rooms the caller cannot see', async () => {
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    const item = await seedItem(app, testUserId, room.id)
    const res = await app.inject({ method: 'GET', url: `/items/${item.id}`, headers: asAuth(testOtherUserId) })
    expect(res.statusCode).toBe(404)
  })
})

describe('deleteItem', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/items/00000000-0000-0000-0000-000000000000' })
    expect(res.statusCode).toBe(401)
  })

  it('DELETE /items/{itemId} tombstones the placement and keeps replies attached', async () => {
    const room = await seedRoom(app, testUserId)
    const parent = await seedItem(app, testUserId, room.id, { text: 'secret' })
    const reply = await seedReply(app, testOtherUserId, parent.id, { text: 'reply' })

    const res = await app.inject({ method: 'DELETE', url: `/items/${parent.id}`, headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('deleteItem', 200, res.json())
    expect(res.json().data).toMatchObject({ reactions: [], message: { text: null, media: [] } })
    expect(res.json().data.deletedAt).toBeTruthy()

    const list = await app.inject({ method: 'GET', url: `/rooms/${room.id}/items`, headers: asAuth(testUserId) })
    const items = list.json().data
    expect(items).toHaveLength(2)
    expect(items.find((i: any) => i.id === reply.id).parentId).toBe(parent.id)
    expect(list.body).not.toContain('secret')
  })

  it('deleting one placement leaves the message visible where it was shared', async () => {
    const a = await seedRoom(app, testUserId)
    const b = await seedRoom(app, testUserId)
    const original = await seedItem(app, testUserId, a.id, { text: 'everywhere' })
    await app.inject({ method: 'POST', url: `/messages/${original.messageId}/share`, headers: asAuth(testUserId), payload: { roomIds: [b.id] } })
    await app.inject({ method: 'DELETE', url: `/items/${original.id}`, headers: asAuth(testUserId) })

    const inB = await app.inject({ method: 'GET', url: `/rooms/${b.id}/items`, headers: asAuth(testUserId) })
    expect(inB.json().data[0].message.text).toBe('everywhere')
  })

  it('forbids deleting someone else’s item', async () => {
    const room = await seedRoom(app, testUserId)
    const item = await seedItem(app, testUserId, room.id)
    const res = await app.inject({ method: 'DELETE', url: `/items/${item.id}`, headers: asAuth(testOtherUserId) })
    expect(res.statusCode).toBe(403)
  })
})

// ─── anchored replies (V1: a moment in the parent's single audio/video clip) ───
describe('replyToItem — anchors', () => {
  const upload = async (userId: string, opts: { type?: string; duration?: string } = {}) => {
    const parts: Array<{ name: string; value: string | Buffer; filename?: string; type?: string }> = [
      { name: 'file', value: Buffer.from('media-bytes'), filename: 'clip', type: opts.type ?? 'audio/webm' },
    ]
    if (opts.duration !== undefined) parts.push({ name: 'duration', value: opts.duration })
    const form = multipart(parts)
    const res = await app.inject({ method: 'POST', url: '/media', headers: { ...asAuth(userId), ...form.headers }, payload: form.payload })
    return res.json().data as { id: string }
  }
  const replyTo = (userId: string, itemId: string, payload: object) =>
    app.inject({ method: 'POST', url: `/items/${itemId}/replies`, headers: asAuth(userId), payload })

  // Parent: a 12.5s audio clip → anchors valid in [0, 12500] ms.
  async function audioParent(duration: string | undefined = '12.5') {
    const room = await seedRoom(app, testUserId)
    const media = await upload(testUserId, { duration })
    const parent = await seedItem(app, testUserId, room.id, { mediaIds: [media.id] })
    return { room, parent }
  }

  it('stores the moment on the reply Item and returns it', async () => {
    const { room, parent } = await audioParent()
    const res = await replyTo(testOtherUserId, parent.id, { text: 'right here', anchorStartMs: 4200 })
    expect(res.statusCode).toBe(201)
    await validateResponse('replyToItem', 201, res.json())
    expect(res.json().data).toMatchObject({ parentId: parent.id, roomId: room.id, anchorStartMs: 4200 })

    const list = await app.inject({ method: 'GET', url: `/rooms/${room.id}/items`, headers: asAuth(testUserId) })
    await validateResponse('listRoomItems', 200, list.json())
    expect(list.json().data.find((i: any) => i.parentId === parent.id).anchorStartMs).toBe(4200)
  })

  it('accepts the exact end of the clip, rejects one ms past it', async () => {
    const { parent } = await audioParent('12.5')
    expect((await replyTo(testUserId, parent.id, { text: 'end', anchorStartMs: 12500 })).statusCode).toBe(201)
    const past = await replyTo(testUserId, parent.id, { text: 'past', anchorStartMs: 12501 })
    expect(past.statusCode).toBe(400)
    expect(past.json().code).toBe('INVALID_ANCHOR')
  })

  it('rejects negative and fractional anchors (schema)', async () => {
    const { parent } = await audioParent()
    expect((await replyTo(testUserId, parent.id, { text: 'x', anchorStartMs: -1 })).statusCode).toBe(400)
    expect((await replyTo(testUserId, parent.id, { text: 'x', anchorStartMs: 1.5 })).statusCode).toBe(400)
  })

  it('any response type can be anchored (audio reply at a moment)', async () => {
    const { parent } = await audioParent()
    const clip = await upload(testOtherUserId, { duration: '3' })
    const res = await replyTo(testOtherUserId, parent.id, { mediaIds: [clip.id], anchorStartMs: 9000 })
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toMatchObject({ anchorStartMs: 9000, message: { media: [{ id: clip.id }] } })
  })

  it('many replies may share one moment; each stays an individual reply', async () => {
    const { room, parent } = await audioParent()
    for (const t of ['a', 'b', 'c']) expect((await replyTo(testOtherUserId, parent.id, { text: t, anchorStartMs: 1000 })).statusCode).toBe(201)
    const list = await app.inject({ method: 'GET', url: `/rooms/${room.id}/items`, headers: asAuth(testUserId) })
    expect(list.json().data.filter((i: any) => i.anchorStartMs === 1000)).toHaveLength(3)
  })

  it('ANCHOR_UNSUPPORTED: text-only parent, unknown duration, two clips, deleted parent — and nothing is created', async () => {
    const room = await seedRoom(app, testUserId)
    const textParent = await seedItem(app, testUserId, room.id, { text: 'no media' })
    const noDuration = await seedItem(app, testUserId, room.id, { mediaIds: [(await upload(testUserId)).id] })
    const twoClips = await seedItem(app, testUserId, room.id, {
      mediaIds: [(await upload(testUserId, { duration: '2' })).id, (await upload(testUserId, { duration: '4' })).id],
    })
    const deleted = (await audioParent()).parent
    await app.inject({ method: 'DELETE', url: `/items/${deleted.id}`, headers: asAuth(testUserId) })

    const messagesBefore = await db.message.count()
    for (const target of [textParent, noDuration, twoClips, deleted]) {
      const res = await replyTo(testUserId, target.id, { text: 'here', anchorStartMs: 0 })
      expect(res.statusCode).toBe(400)
      expect(res.json().code).toBe('ANCHOR_UNSUPPORTED')
    }
    expect(await db.message.count()).toBe(messagesBefore)
  })

  it('an image + one audio clip still has exactly one timed attachment', async () => {
    const room = await seedRoom(app, testUserId)
    const img = await upload(testUserId, { type: 'image/png' })
    const aud = await upload(testUserId, { duration: '5' })
    const parent = await seedItem(app, testUserId, room.id, { mediaIds: [img.id, aud.id] })
    expect((await replyTo(testUserId, parent.id, { text: 'ok', anchorStartMs: 2500 })).statusCode).toBe(201)
  })

  it('sendMessage does not accept anchors (top-level items have no parent)', async () => {
    const room = await seedRoom(app, testUserId)
    const res = await app.inject({ method: 'POST', url: `/rooms/${room.id}/items`, headers: asAuth(testUserId), payload: { text: 'x', anchorStartMs: 0 } })
    expect(res.statusCode).toBe(400)
  })

  it('anchors are placement-level: sharing the parent carries none of them', async () => {
    const { parent } = await audioParent()
    await replyTo(testOtherUserId, parent.id, { text: 'here', anchorStartMs: 500 })
    const other = await seedRoom(app, testUserId)
    const shared = await app.inject({ method: 'POST', url: `/messages/${parent.messageId}/share`, headers: asAuth(testUserId), payload: { roomIds: [other.id] } })
    const inOther = await app.inject({ method: 'GET', url: `/rooms/${other.id}/items`, headers: asAuth(testUserId) })
    expect(inOther.json().data).toHaveLength(1) // the shared placement only
    expect(inOther.json().data[0]).toMatchObject({ id: shared.json().data[0].id, anchorStartMs: null, parentId: null })
  })

  it('un-anchored replies behave exactly as before (anchorStartMs: null)', async () => {
    const { parent } = await audioParent()
    const res = await replyTo(testUserId, parent.id, { text: 'plain' })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.anchorStartMs).toBeNull()
  })
})

describe('getRiver', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/river' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /river', async () => {
    // TODO: seed domain data (test users are pre-seeded by buildTestApp)
    const res = await app.inject({
      method: 'GET',
      url: '/river',
      headers: asAuth(testUserId),
      // payload: {},
    })
    expect(res.statusCode).toBe(200)
    await validateResponse('getRiver', 200, res.json())
  })
})
