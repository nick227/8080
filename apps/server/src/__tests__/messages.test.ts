// Generated from openapi.yaml — fill in seeds and assertions.
// Run `pnpm test:generate` to add stubs for new routes.
// Share = new Item placements that reuse one Message and its media.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, seedRoom, seedItem, multipart } from './helpers'

const app = buildTestApp()

const share = (userId: string, messageId: string, roomIds: string[]) =>
  app.inject({ method: 'POST', url: `/messages/${messageId}/share`, headers: asAuth(userId), payload: { roomIds } })

async function uploadAudio(userId: string) {
  const form = multipart([{ name: 'file', value: Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.from('audio-bytes')]), filename: 'rec', type: 'audio/webm' }])
  const res = await app.inject({ method: 'POST', url: '/media', headers: { ...asAuth(userId), ...form.headers }, payload: form.payload })
  return res.json().data as { id: string; url: string }
}

describe('shareMessageToRooms', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/messages/00000000-0000-0000-0000-000000000000/share' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /messages/{messageId}/share creates one Item per room and reuses the Message', async () => {
    const [a, b, c] = [await seedRoom(app, testUserId), await seedRoom(app, testUserId), await seedRoom(app, testOtherUserId)]
    const original = await seedItem(app, testUserId, a.id, { text: 'broadcast' })

    const res = await share(testUserId, original.messageId, [b.id, c.id])
    expect(res.statusCode).toBe(201)
    await validateResponse('shareMessageToRooms', 201, res.json())
    const items = res.json().data
    expect(items.map((i: any) => i.roomId).sort()).toEqual([b.id, c.id].sort())
    for (const i of items) {
      expect(i).toMatchObject({ messageId: original.messageId, parentId: null, number: 1, reactions: [] })
      expect(i.message).toMatchObject({ id: original.messageId, text: 'broadcast', author: { id: testUserId } })
    }
    expect(await db.message.count()).toBe(1)
    expect(await db.item.count({ where: { messageId: original.messageId } })).toBe(3)
  })

  it('does not duplicate media: same Media rows and URLs in every room', async () => {
    const [a, b] = [await seedRoom(app, testUserId), await seedRoom(app, testUserId)]
    const media = await uploadAudio(testUserId)
    const original = await seedItem(app, testUserId, a.id, { mediaIds: [media.id] })
    const mediaRowsBefore = await db.media.count()

    const res = await share(testUserId, original.messageId, [b.id])
    const inB = res.json().data[0]
    expect(inB.message.media).toHaveLength(1)
    expect(inB.message.media[0]).toMatchObject({ id: media.id, url: media.url })
    expect(await db.media.count()).toBe(mediaRowsBefore)
    expect(await db.media.findUnique({ where: { id: media.id } })).toMatchObject({ messageId: original.messageId })
  })

  it('is idempotent: rooms that already have the message are skipped', async () => {
    const [a, b] = [await seedRoom(app, testUserId), await seedRoom(app, testUserId)]
    const original = await seedItem(app, testUserId, a.id)
    await share(testUserId, original.messageId, [b.id])
    const again = await share(testUserId, original.messageId, [a.id, b.id])
    expect(again.statusCode).toBe(201)
    expect(again.json().data).toEqual([])
    expect(await db.item.count({ where: { messageId: original.messageId } })).toBe(2)
  })

  it('reactions belong to each placement, not the shared message', async () => {
    const [a, b] = [await seedRoom(app, testUserId), await seedRoom(app, testUserId)]
    const original = await seedItem(app, testUserId, a.id)
    const inB = (await share(testUserId, original.messageId, [b.id])).json().data[0]
    await app.inject({ method: 'PUT', url: `/items/${original.id}/reactions/like`, headers: asAuth(testOtherUserId) })
    const b1 = await app.inject({ method: 'GET', url: `/items/${inB.id}`, headers: asAuth(testUserId) })
    expect(b1.json().data.reactions).toEqual([])
  })

  it('only the author may share (403); non-viewers get 404', async () => {
    const [a, b] = [await seedRoom(app, testUserId), await seedRoom(app, testOtherUserId)]
    const original = await seedItem(app, testUserId, a.id)
    const res = await share(testOtherUserId, original.messageId, [b.id])
    expect(res.statusCode).toBe(403)

    const priv = await seedRoom(app, testUserId, { visibility: 'private' })
    const hidden = await seedItem(app, testUserId, priv.id)
    const res2 = await share(testOtherUserId, hidden.messageId, [b.id])
    expect(res2.statusCode).toBe(404)
  })

  it('all-or-nothing: an invisible target room fails the whole share', async () => {
    const [a, b] = [await seedRoom(app, testUserId), await seedRoom(app, testUserId)]
    const theirsPrivate = await seedRoom(app, testOtherUserId, { visibility: 'private' })
    const original = await seedItem(app, testUserId, a.id)
    const res = await share(testUserId, original.messageId, [b.id, theirsPrivate.id])
    expect(res.statusCode).toBe(404)
    expect(await db.item.count({ where: { messageId: original.messageId } })).toBe(1)
  })

  it('404 for an unknown message', async () => {
    const b = await seedRoom(app, testUserId)
    const res = await share(testUserId, 'nope', [b.id])
    expect(res.statusCode).toBe(404)
  })

  it('validates the body (roomIds required, non-empty)', async () => {
    const a = await seedRoom(app, testUserId)
    const original = await seedItem(app, testUserId, a.id)
    expect((await share(testUserId, original.messageId, [])).statusCode).toBe(400)
  })

  it('replies stay in the room they were made (they do not broadcast)', async () => {
    const [a, b, c] = [await seedRoom(app, testUserId), await seedRoom(app, testUserId), await seedRoom(app, testUserId)]
    const original = await seedItem(app, testUserId, a.id, { text: 'A origin' })
    const res = await share(testUserId, original.messageId, [b.id, c.id])
    const items = res.json().data

    const inB = items.find((i: any) => i.roomId === b.id)
    const inC = items.find((i: any) => i.roomId === c.id)

    expect(original.messageId).toBe(inB.message.id)
    expect(original.messageId).toBe(inC.message.id)
    expect(original.id).not.toBe(inB.id)
    expect(original.id).not.toBe(inC.id)
    expect(inB.id).not.toBe(inC.id)

    // reply in B
    const replyRes = await app.inject({
      method: 'POST',
      url: `/items/${inB.id}/replies`,
      headers: asAuth(testUserId),
      payload: { text: 'Reply in B' },
    })
    expect(replyRes.statusCode).toBe(201)
    const reply = replyRes.json().data

    // confirm that reply does not appear in A or C
    const aItems = await app.inject({ method: 'GET', url: `/rooms/${a.id}/items`, headers: asAuth(testUserId) })
    const cItems = await app.inject({ method: 'GET', url: `/rooms/${c.id}/items`, headers: asAuth(testUserId) })

    expect(aItems.json().data.some((i: any) => i.id === reply.id)).toBe(false)
    expect(cItems.json().data.some((i: any) => i.id === reply.id)).toBe(false)
    expect(reply.roomId).toBe(b.id)
    expect(reply.parentId).toBe(inB.id)
  })
})
