// Live video tokens (services/live.ts): room access stays authoritative, tokens are
// short-lived, room-scoped, and publish only camera/screen share for people.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, seedRoom } from './helpers'

const app = buildTestApp()
const ENV = { LIVEKIT_URL: 'wss://live.test', LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: 'test-secret-test-secret-test-secret' }

const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'))
const token = (userId: string, roomId: string) => app.inject({ method: 'GET', url: `/rooms/${roomId}/live-token`, headers: asAuth(userId) })

describe('getLiveToken', () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => { for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v } })
  afterEach(() => { for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

  it('requires auth', async () => {
    const room = await seedRoom(app, testUserId)
    expect((await app.inject({ method: 'GET', url: `/rooms/${room.id}/live-token` })).statusCode).toBe(401)
  })

  it('mints a 10-minute token for this room, identity = the user, camera + screen share only', async () => {
    const room = await seedRoom(app, testUserId)
    const res = await token(testOtherUserId, room.id) // a viewer of a public room (Bob, a guest)
    expect(res.statusCode).toBe(200)
    await validateResponse('getLiveToken', 200, res.json())
    const data = res.json().data
    expect(data).toMatchObject({ url: ENV.LIVEKIT_URL, room: room.id, canPublish: true })
    const c = claims(data.token)
    expect(c.sub).toBe(testOtherUserId)
    expect(c.name).toBe('Guest BOB')
    expect(c.exp - c.nbf).toBe(600)
    expect(c.video).toMatchObject({ room: room.id, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false, canPublishSources: ['camera', 'screen_share'] })
  })

  it('private rooms: members only (404 otherwise, like every room read)', async () => {
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    expect((await token(testOtherUserId, room.id)).statusCode).toBe(404)
    expect((await token(testUserId, room.id)).statusCode).toBe(200)
  })

  it('bots and suspended accounts may watch but not publish', async () => {
    const room = await seedRoom(app, testUserId)
    await db.user.update({ where: { id: testOtherUserId }, data: { suspendedAt: new Date() } })
    const res = (await token(testOtherUserId, room.id)).json().data
    expect(res.canPublish).toBe(false)
    expect(claims(res.token).video).toMatchObject({ canSubscribe: true, canPublish: false })
  })

  it('503 LIVE_UNAVAILABLE without LiveKit configuration', async () => {
    const room = await seedRoom(app, testUserId)
    delete process.env.LIVEKIT_API_SECRET
    const res = await token(testUserId, room.id)
    expect(res.statusCode).toBe(503)
    expect(res.json().code).toBe('LIVE_UNAVAILABLE')
  })
})
