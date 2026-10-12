import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, asAuth, testUserId, testOtherUserId, seedRoom } from './helpers'
const app = buildTestApp()
const token = (userId: string, roomId: string) => app.inject({ method: 'GET', url: `/rooms/${roomId}/live-token`, headers: asAuth(userId) })

describe('Live admission baseline', () => {
  it('requires authentication', async () => {
    const room = await seedRoom(app, testUserId)
    expect((await app.inject({ url: `/rooms/${room.id}/live-token` })).statusCode).toBe(401)
  })
  it('denies guests and registered Free accounts, including viewers', async () => {
    const room = await seedRoom(app, testUserId)
    for (const id of [testUserId, testOtherUserId]) {
      const res = await token(id, room.id)
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('PREMIUM_REQUIRED')
      expect(res.json().data?.token).toBeUndefined()
    }
  })
  it('keeps private rooms hidden from non-members', async () => {
    const room = await seedRoom(app, testUserId, { visibility: 'private' })
    expect((await token(testOtherUserId, room.id)).statusCode).toBe(404)
  })
  it('denies suspended accounts even when called through a substituted auth handler', async () => {
    const room = await seedRoom(app, testUserId)
    await db.user.update({ where: { id: testOtherUserId }, data: { suspendedAt: new Date() } })
    expect((await token(testOtherUserId, room.id)).json().code).toBe('ACCOUNT_SUSPENDED')
  })
  it('does not open unlimited Live when a complimentary grant is created', async () => {
    const room = await seedRoom(app, testUserId)
    await db.premiumGrant.create({ data: { userId: testUserId, grantedById: 'test', reason: 'Test grant', expiresAt: new Date(Date.now()+86400000) } })
    const res = await token(testUserId, room.id)
    expect(res.statusCode).toBe(503)
    expect(res.json().code).toBe('LIVE_NOT_ENABLED')
  })
})
