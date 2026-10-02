// Generated from openapi.yaml — fill in seeds and assertions.
// Run `pnpm test:generate` to add stubs for new routes.
// Alice (testUserId) owns rooms; Bob (testOtherUserId) is the outsider.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { randomUUID } from 'crypto'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, seedRoom, seedItem, seedReply } from './helpers'
import { recountRooms } from '../services/roomStats'

const app = buildTestApp()

describe('listRooms', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/rooms' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /rooms lists public rooms only, most recently active first', async () => {
    const quiet = await seedRoom(app, testUserId, { title: 'Quiet' })
    const busy = await seedRoom(app, testUserId, { title: 'Busy' })
    await seedRoom(app, testUserId, { title: 'Secret', visibility: 'private' })
    await seedItem(app, testUserId, quiet.id) // bumps Quiet above Busy

    const res = await app.inject({ method: 'GET', url: '/rooms', headers: asAuth(testOtherUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('listRooms', 200, res.json())
    const titles = res.json().data.map((r: any) => r.title)
    expect(titles).toEqual(['Quiet', 'Busy'])
    expect(res.json().data[0].role).toBeNull() // Bob isn't a member
    expect(busy.id).toBeTruthy()
  })

  it('filters by q and topic', async () => {
    await seedRoom(app, testUserId, { title: 'Design crit', topic: 'Design' })
    await seedRoom(app, testUserId, { title: 'Music talk', topic: 'music' })

    const byQ = await app.inject({ method: 'GET', url: '/rooms?q=crit', headers: asAuth(testUserId) })
    expect(byQ.json().data.map((r: any) => r.title)).toEqual(['Design crit'])

    const byTopic = await app.inject({ method: 'GET', url: '/rooms?topic=music', headers: asAuth(testUserId) })
    expect(byTopic.json().data.map((r: any) => r.title)).toEqual(['Music talk'])
  })

  it('paginates with an opaque cursor without skipping or repeating', async () => {
    for (const title of ['A', 'B', 'C']) await seedRoom(app, testUserId, { title })
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const qs: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      const res = await app.inject({ method: 'GET', url: `/rooms?limit=2${qs}`, headers: asAuth(testUserId) })
      const body = res.json()
      seen.push(...body.data.map((r: any) => r.title))
      cursor = body.meta.nextCursor
      expect(body.meta.hasMore).toBe(cursor !== null)
    } while (cursor)
    expect(seen.sort()).toEqual(['A', 'B', 'C'])
  })

  it('rejects a garbage cursor with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/rooms?cursor=not-a-cursor', headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(400)
  })
})

describe('createRoom', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/rooms' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /rooms creates a public room owned by the caller', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rooms',
      headers: asAuth(testUserId),
      payload: { title: '  Open channel ', topic: 'General' },
    })
    expect(res.statusCode).toBe(201)
    await validateResponse('createRoom', 201, res.json())
    expect(res.json().data).toMatchObject({
      title: 'Open channel',
      topic: 'general',
      visibility: 'public',
      role: 'owner',
      memberCount: 1,
      itemCount: 0,
      inviteCode: null,
    })
  })

  it('private rooms get an invite code visible to the owner', async () => {
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    expect(room.inviteCode).toMatch(/^[A-Za-z0-9_-]{12}$/)
  })

  it('assigns increasing room numbers', async () => {
    const a = await seedRoom(app, testUserId)
    const b = await seedRoom(app, testUserId)
    expect(b.number).toBeGreaterThan(a.number)
  })

  it('rejects an empty title', async () => {
    const res = await app.inject({ method: 'POST', url: '/rooms', headers: asAuth(testUserId), payload: { title: '' } })
    expect(res.statusCode).toBe(400)
  })
})

describe('listMyRooms', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/rooms/mine' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /rooms/mine includes private rooms the caller belongs to', async () => {
    await seedRoom(app, testUserId, { title: 'Mine public' })
    await seedRoom(app, testUserId, { title: 'Mine private', visibility: 'private' })
    await seedRoom(app, testOtherUserId, { title: 'Theirs' })

    const res = await app.inject({ method: 'GET', url: '/rooms/mine', headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('listMyRooms', 200, res.json())
    expect(res.json().data.map((r: any) => r.title).sort()).toEqual(['Mine private', 'Mine public'])
  })
})

describe('getRoom', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/rooms/00000000-0000-0000-0000-000000000000' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /rooms/{roomId}', async () => {
    const room = await seedRoom(app, testUserId)
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}`, headers: asAuth(testOtherUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('getRoom', 200, res.json())
    expect(res.json().data.id).toBe(room.id)
  })

  it('hides private rooms from non-members with 404', async () => {
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}`, headers: asAuth(testOtherUserId) })
    expect(res.statusCode).toBe(404)
  })
})

describe('updateRoom', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/rooms/00000000-0000-0000-0000-000000000000' })
    expect(res.statusCode).toBe(401)
  })

  it('PATCH /rooms/{roomId} by the owner', async () => {
    const room = await seedRoom(app, testUserId)
    const res = await app.inject({
      method: 'PATCH',
      url: `/rooms/${room.id}`,
      headers: asAuth(testUserId),
      payload: { title: 'Renamed', topic: null, visibility: 'private' },
    })
    expect(res.statusCode).toBe(200)
    await validateResponse('updateRoom', 200, res.json())
    expect(res.json().data).toMatchObject({ title: 'Renamed', topic: null, visibility: 'private' })
    expect(res.json().data.inviteCode).toBeTruthy() // going private issues a code
  })

  it('forbids non-owners', async () => {
    const room = await seedRoom(app, testUserId)
    const res = await app.inject({
      method: 'PATCH',
      url: `/rooms/${room.id}`,
      headers: asAuth(testOtherUserId),
      payload: { title: 'Hijacked' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('updates the description', async () => {
    const room = await seedRoom(app, testUserId)
    const res = await app.inject({
      method: 'PATCH',
      url: `/rooms/${room.id}`,
      headers: asAuth(testUserId),
      payload: { description: '  A quiet room  ' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.description).toBe('A quiet room')
  })
})

describe('deleteRoom', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/rooms/00000000-0000-0000-0000-000000000000' })
    expect(res.statusCode).toBe(401)
  })

  it('lets the owner delete, then hides the room', async () => {
    const room = await seedRoom(app, testUserId, { title: 'Gone' })
    const res = await app.inject({
      method: 'DELETE',
      url: `/rooms/${room.id}`,
      headers: asAuth(testUserId),
    })
    expect(res.statusCode).toBe(200)
    await validateResponse('deleteRoom', 200, res.json())
    expect(res.json().data).toBeNull()

    const gone = await app.inject({ method: 'GET', url: `/rooms/${room.id}`, headers: asAuth(testUserId) })
    expect(gone.statusCode).toBe(404)
    const listed = await app.inject({ method: 'GET', url: '/rooms', headers: asAuth(testUserId) })
    expect(listed.json().data.map((row: { id: string }) => row.id)).not.toContain(room.id)
  })

  it('forbids non-owners', async () => {
    const room = await seedRoom(app, testUserId)
    const res = await app.inject({
      method: 'DELETE',
      url: `/rooms/${room.id}`,
      headers: asAuth(testOtherUserId),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('joinRoom', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/rooms/00000000-0000-0000-0000-000000000000/join' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /rooms/{roomId}/join a public room', async () => {
    const room = await seedRoom(app, testUserId)
    const res = await app.inject({ method: 'POST', url: `/rooms/${room.id}/join`, headers: asAuth(testOtherUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('joinRoom', 200, res.json())
    expect(res.json().data).toMatchObject({ role: 'member', memberCount: 2 })

    const again = await app.inject({ method: 'POST', url: `/rooms/${room.id}/join`, headers: asAuth(testOtherUserId) })
    expect(again.json().data.memberCount).toBe(2) // idempotent
  })

  it('private rooms require the invite code; wrong code looks like no room', async () => {
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    const url = `/rooms/${room.id}/join`

    const none = await app.inject({ method: 'POST', url, headers: asAuth(testOtherUserId) })
    expect(none.statusCode).toBe(404)
    const wrong = await app.inject({ method: 'POST', url, headers: asAuth(testOtherUserId), payload: { inviteCode: 'nope' } })
    expect(wrong.statusCode).toBe(404)

    const ok = await app.inject({
      method: 'POST',
      url,
      headers: asAuth(testOtherUserId),
      payload: { inviteCode: room.inviteCode },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data.inviteCode).toBe(room.inviteCode) // members can share it
  })
})

describe('leaveRoom', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/rooms/00000000-0000-0000-0000-000000000000/members/me' })
    expect(res.statusCode).toBe(401)
  })

  it('DELETE /rooms/{roomId}/members/me', async () => {
    const room = await seedRoom(app, testUserId)
    await app.inject({ method: 'POST', url: `/rooms/${room.id}/join`, headers: asAuth(testOtherUserId) })
    const res = await app.inject({
      method: 'DELETE',
      url: `/rooms/${room.id}/members/me`,
      headers: asAuth(testOtherUserId),
    })
    expect(res.statusCode).toBe(200)
    await validateResponse('leaveRoom', 200, res.json())
    const after = await app.inject({ method: 'GET', url: `/rooms/${room.id}`, headers: asAuth(testOtherUserId) })
    expect(after.json().data.role).toBeNull()
  })

  it('owners cannot leave', async () => {
    const room = await seedRoom(app, testUserId)
    const res = await app.inject({ method: 'DELETE', url: `/rooms/${room.id}/members/me`, headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(403)
  })
})

describe('rotateInviteCode', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/rooms/00000000-0000-0000-0000-000000000000/invite-code' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /rooms/{roomId}/invite-code invalidates the old code', async () => {
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    const res = await app.inject({ method: 'POST', url: `/rooms/${room.id}/invite-code`, headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('rotateInviteCode', 200, res.json())
    expect(res.json().data.inviteCode).not.toBe(room.inviteCode)

    const stale = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/join`,
      headers: asAuth(testOtherUserId),
      payload: { inviteCode: room.inviteCode },
    })
    expect(stale.statusCode).toBe(404)
  })

  it('409 for public rooms, 403 for non-owner members', async () => {
    const pub = await seedRoom(app, testUserId)
    const r1 = await app.inject({ method: 'POST', url: `/rooms/${pub.id}/invite-code`, headers: asAuth(testUserId) })
    expect(r1.statusCode).toBe(409)

    const priv = await seedRoom(app, testUserId, { visibility: 'private' })
    await app.inject({
      method: 'POST',
      url: `/rooms/${priv.id}/join`,
      headers: asAuth(testOtherUserId),
      payload: { inviteCode: priv.inviteCode },
    })
    const r2 = await app.inject({ method: 'POST', url: `/rooms/${priv.id}/invite-code`, headers: asAuth(testOtherUserId) })
    expect(r2.statusCode).toBe(403)
  })
})

describe('room stats (responses, length, last response)', () => {
  const media = (ownerId: string, kind: 'audio' | 'video' | 'image', duration?: number) =>
    db.media.create({ data: { ownerId, kind, duration, storageKey: `${randomUUID()}.${kind === 'image' ? 'png' : 'webm'}`, mimeType: `${kind}/x`, size: 1 } })
  const stats = async (roomId: string) => {
    const res = await app.inject({ method: 'GET', url: `/rooms/${roomId}`, headers: asAuth(testUserId) })
    const { responseCount, durationMs, lastResponseAt } = res.json().data
    return { responseCount, durationMs, lastResponseAt }
  }
  const del = (userId: string, itemId: string) => app.inject({ method: 'DELETE', url: `/items/${itemId}`, headers: asAuth(userId) })

  it('counts every live item after the opening one, and all audio/video time', async () => {
    const room = await seedRoom(app, testUserId)
    const opener = await seedItem(app, testUserId, room.id, { mediaIds: [(await media(testUserId, 'video', 90.5)).id] })
    expect(await stats(room.id)).toEqual({ responseCount: 0, durationMs: 90500, lastResponseAt: null })

    await seedReply(app, testOtherUserId, opener.id, { mediaIds: [(await media(testOtherUserId, 'audio', 12.25)).id, (await media(testOtherUserId, 'image')).id] })
    const second = await seedItem(app, testUserId, room.id, { text: 'a second top-level post is a response too' })
    const after = await stats(room.id)
    const secondAt = (await db.item.findUniqueOrThrow({ where: { id: second.id } })).createdAt.toISOString()
    expect(after).toEqual({ responseCount: 2, durationMs: 102750, lastResponseAt: secondAt })
  })

  it('a deleted item stops counting (responses, length, last response)', async () => {
    const room = await seedRoom(app, testUserId)
    const opener = await seedItem(app, testUserId, room.id, { text: 'opening' })
    const kept = await seedReply(app, testUserId, opener.id, { text: 'kept' })
    const gone = await seedReply(app, testUserId, opener.id, { mediaIds: [(await media(testUserId, 'audio', 30)).id] })
    expect((await stats(room.id)).durationMs).toBe(30000)
    expect((await del(testUserId, gone.id)).statusCode).toBe(200)
    const keptAt = (await db.item.findUniqueOrThrow({ where: { id: kept.id } })).createdAt.toISOString()
    expect(await stats(room.id)).toEqual({ responseCount: 1, durationMs: 0, lastResponseAt: keptAt })
    await del(testUserId, kept.id)
    expect(await stats(room.id)).toEqual({ responseCount: 0, durationMs: 0, lastResponseAt: null })
  })

  it('a share counts in the target room; deleting the capture updates every room', async () => {
    const a = await seedRoom(app, testUserId)
    const b = await seedRoom(app, testUserId)
    await seedItem(app, testUserId, b.id, { text: 'b opens' })
    const clip = await seedItem(app, testUserId, a.id, { mediaIds: [(await media(testUserId, 'audio', 8)).id] })
    await app.inject({ method: 'POST', url: `/messages/${clip.messageId}/share`, headers: asAuth(testUserId), payload: { roomIds: [b.id] } })
    expect(await stats(b.id)).toMatchObject({ responseCount: 1, durationMs: 8000 })
    await del(testUserId, clip.id)
    expect(await stats(a.id)).toMatchObject({ responseCount: 0, durationMs: 0 })
    expect(await stats(b.id)).toMatchObject({ responseCount: 0, durationMs: 0, lastResponseAt: null })
  })

  it('recountRooms repairs drifted numbers (backfill)', async () => {
    const room = await seedRoom(app, testUserId)
    const opener = await seedItem(app, testUserId, room.id, { text: 'opening' })
    await seedReply(app, testUserId, opener.id, { mediaIds: [(await media(testUserId, 'audio', 2)).id] })
    await db.room.update({ where: { id: room.id }, data: { responseCount: 99, durationMs: 0, lastResponseAt: null } })
    await recountRooms(db, [room.id])
    expect(await stats(room.id)).toMatchObject({ responseCount: 1, durationMs: 2000, lastResponseAt: expect.any(String) })
  })
})

describe('room thumbnail fallback', () => {
  const picture = (ownerId: string) =>
    db.media.create({ data: { ownerId, kind: 'image', storageKey: `${randomUUID()}.png`, mimeType: 'image/png', size: 1 } })
  const audio = (ownerId: string) =>
    db.media.create({ data: { ownerId, kind: 'audio', duration: 3, storageKey: `${randomUUID()}.webm`, mimeType: 'audio/webm', size: 1 } })

  it('a room without a thumbnail shows its earliest live picture', async () => {
    const room = await seedRoom(app, testUserId)
    await db.room.update({ where: { id: room.id }, data: { thumbnailId: null } })
    await seedItem(app, testUserId, room.id, { mediaIds: [(await audio(testUserId)).id] })
    const deleted = await seedItem(app, testUserId, room.id, { mediaIds: [(await picture(testUserId)).id] })
    const later = await picture(testUserId)
    await seedItem(app, testUserId, room.id, { mediaIds: [later.id] })
    await app.inject({ method: 'DELETE', url: `/items/${deleted.id}`, headers: asAuth(testUserId) })

    const list = await app.inject({ method: 'GET', url: '/rooms/mine', headers: asAuth(testUserId) })
    await validateResponse('listMyRooms', 200, list.json())
    expect(list.json().data.find((r: { id: string }) => r.id === room.id).thumbnail).toMatchObject({ id: later.id, type: 'image' })
    const one = await app.inject({ method: 'GET', url: `/rooms/${room.id}`, headers: asAuth(testUserId) })
    expect(one.json().data.thumbnail).toMatchObject({ id: later.id })
  })

  it('no picture at all → null (the card shows the room number)', async () => {
    const room = await seedRoom(app, testUserId)
    await db.room.update({ where: { id: room.id }, data: { thumbnailId: null } })
    await seedItem(app, testUserId, room.id, { text: 'words only' })
    const one = await app.inject({ method: 'GET', url: `/rooms/${room.id}`, headers: asAuth(testUserId) })
    expect(one.json().data.thumbnail).toBeNull()
  })
})
