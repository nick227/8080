// Generated from openapi.yaml — fill in seeds and assertions.
// Run `pnpm test:generate` to add stubs for new routes.
// Alice (testUserId) owns rooms; Bob (testOtherUserId) is the outsider.
import { describe, it, expect } from 'vitest'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, seedRoom, seedItem } from './helpers'

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
