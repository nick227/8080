import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { EventEmitter } from 'events'
import { watchAccountStream } from '../services/authorization/accountStreams'
import { db } from '@project/db'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app'
import { entitlements } from '../services/admin/entitlements'
import { authorize } from '../services/authorization'
import { validateResponse } from './helpers'

let app: FastifyInstance
const owner = 'admin-owner', ordinary = 'admin-ordinary', admin = 'admin-staff'
const until = () => new Date(Date.now() + 86400000).toISOString()
const auth = (id: string) => ({ authorization: `Bearer session-${id}` })
beforeAll(async () => { app = await buildApp({ adminMfa: false, docs: false, rateLimit: false }); await app.ready() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  for (const id of [owner, ordinary, admin]) {
    await db.user.create({ data: { id, isGuest: false, email: `${id}@test.local`, profile: { create: { displayName: id } } } })
    await db.session.create({ data: { userId: id, token: `session-${id}`, expiresAt: new Date(Date.now() + 86400000) } })
  }
  await db.platformStaff.createMany({ data: [{ userId: owner, role: 'platform_owner', grantedById: 'test' }, { userId: admin, role: 'platform_admin', grantedById: owner }] })
})
const change = (action: string, extra: Record<string, unknown> = {}, actor = owner, target = ordinary) => app.inject({
  method: 'POST', url: `/admin/users/${target}/actions`, headers: auth(actor),
  payload: { action, expectedVersion: 0, reason: 'Support request verified', confirmed: true, ...extra },
})

describe('platform administration with real session authentication', () => {
  it('requires a real session and platform staff; workspace owners are not staff', async () => {
    await db.workspace.create({ data: { id: 'scope-workspace', name: 'Private company', slug: 'scope-workspace', createdById: ordinary, members: { create: { userId: ordinary, role: 'owner' } } } })
    expect((await app.inject({ url: '/admin/users' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/admin/users', headers: auth(ordinary) })).statusCode).toBe(403)
    await expect(authorize(ordinary, { scope: 'workspace', workspaceId: 'scope-workspace', permission: 'workspace.read' })).resolves.toHaveProperty('member')
    await expect(authorize(owner, { scope: 'workspace', workspaceId: 'scope-workspace', permission: 'workspace.read' })).rejects.toMatchObject({ statusCode: 404 })
    const res = await app.inject({ url: '/admin/users?q=ordinary', headers: auth(owner) })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(res.body).not.toContain('passwordHash')
    await validateResponse('getAdminUsers', 200, res.json())
  })
  it('creates a personal grant and audit atomically, rejects stale/replayed confirmation', async () => {
    const res = await change('grant_premium', { expiresAt: until() })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.premium).toMatchObject({ tier: 'premium', source: 'grant', liveAvailable: false })
    await validateResponse('updateAdminUser', 200, res.json())
    expect(await db.adminAuditEvent.count()).toBe(1)
    expect((await change('grant_premium', { expiresAt: until() })).statusCode).toBe(409)
    expect(await db.premiumGrant.count()).toBe(1)
    expect(await db.adminAuditEvent.count()).toBe(1)
    expect((await app.inject({ url: '/me/entitlements', headers: auth(ordinary) })).json().data.tier).toBe('premium')
  })
  it('revokes every complimentary grant without changing workspace memberships', async () => {
    await change('grant_premium', { expiresAt: until() })
    const res = await change('revoke_premium', { expectedVersion: 1 })
    expect(res.statusCode).toBe(200)
    expect((await entitlements(ordinary)).tier).toBe('free')
    expect(await db.adminAuditEvent.count()).toBe(2)
  })
  it('rejects expired grants, guests, absent confirmation, and whitespace reasons', async () => {
    expect((await change('grant_premium', { expiresAt: '2020-01-01T00:00:00Z' })).statusCode).toBe(400)
    expect((await change('suspend', { confirmed: false })).statusCode).toBe(400)
    expect((await change('suspend', { reason: '   ' })).statusCode).toBe(400)
    await db.user.update({ where: { id: ordinary }, data: { isGuest: true } })
    expect((await change('grant_premium', { expiresAt: until() })).statusCode).toBe(400)
    expect(await db.adminAuditEvent.count()).toBe(0)
  })
  it('ignores expired, future, and revoked grants', async () => {
    await db.premiumGrant.createMany({ data: [
      { userId: ordinary, expiresAt: new Date(0), grantedById: owner, reason: 'Expired' },
      { userId: ordinary, startsAt: new Date(Date.now()+3600000), expiresAt: new Date(until()), grantedById: owner, reason: 'Future' },
      { userId: ordinary, revokedAt: new Date(), expiresAt: new Date(until()), grantedById: owner, reason: 'Revoked' },
    ] })
    expect((await entitlements(ordinary)).tier).toBe('free')
  })
  it('suspends globally, deletes sessions, and does not change grants on reactivation', async () => {
    await change('grant_premium', { expiresAt: until() })
    const raw = new EventEmitter() as EventEmitter & { destroy: () => void }
    let closed = false
    raw.destroy = () => { closed = true; raw.emit('close') }
    watchAccountStream(ordinary, raw)
    expect((await change('suspend', { expectedVersion: 1 })).statusCode).toBe(200)
    expect(closed).toBe(true)
    expect(await db.session.count({ where: { userId: ordinary } })).toBe(0)
    expect((await app.inject({ url: '/me/entitlements', headers: auth(ordinary) })).statusCode).toBe(401)
    await expect(authorize(ordinary, { scope: 'workspace', workspaceId: 'any', permission: 'workspace.read' })).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' })
    expect((await change('reactivate', { expectedVersion: 2 })).statusCode).toBe(200)
    expect((await entitlements(ordinary)).tier).toBe('premium')
  })
  it('protects staff accounts from admins and blocks self-suspension', async () => {
    expect((await change('suspend', {}, admin, owner)).statusCode).toBe(403)
    expect((await change('suspend', {}, owner, owner)).statusCode).toBe(400)
    expect(await db.adminAuditEvent.count()).toBe(0)
  })
  it('checks staff removal immediately instead of trusting session role claims', async () => {
    await db.platformStaff.delete({ where: { userId: owner } })
    expect((await change('suspend')).statusCode).toBe(403)
  })
  it('enforces CSRF and trusted origin for cookie-authenticated writes', async () => {
    const headers = { cookie: `token=session-${owner}`, origin: 'http://localhost:5173' }
    const session = await app.inject({ url: '/admin/me', headers })
    const csrf = session.json().data.csrfToken
    expect(csrf).toHaveLength(64)
    const payload = { action: 'suspend', expectedVersion: 0, reason: 'Confirmed request', confirmed: true }
    const send = (h: Record<string,string>) => app.inject({ method: 'POST', url: `/admin/users/${ordinary}/actions`, headers: h, payload })
    expect((await send(headers)).statusCode).toBe(403)
    expect((await send({ ...headers, 'x-admin-csrf': 'é'.repeat(64) })).statusCode).toBe(403)
    expect((await send({ ...headers, 'x-admin-csrf': csrf, origin: 'https://attacker.example' })).statusCode).toBe(403)
    expect((await send({ ...headers, 'x-admin-csrf': csrf })).statusCode).toBe(200)
  })
  it('allows only one of two concurrent confirmations to commit', async () => {
    const results = await Promise.all([change('grant_premium', { expiresAt: until() }), change('grant_premium', { expiresAt: until() })])
    expect(results.map(r=>r.statusCode).sort()).toEqual([200,409])
    expect(await db.adminAuditEvent.count()).toBe(1)
  })
  it('staff status alone does not grant Premium', async () => {
    expect((await entitlements(owner)).tier).toBe('free')
    expect((await entitlements(admin)).tier).toBe('free')
  })
  it('returns grant history with explicit states and actor-specific actions', async () => {
    await db.premiumGrant.createMany({ data: [
      { id: 'history-expired', userId: ordinary, expiresAt: new Date(0), grantedById: owner, reason: 'Expired' },
      { id: 'history-revoked', userId: ordinary, expiresAt: new Date(until()), revokedAt: new Date(), grantedById: owner, reason: 'Revoked' },
      { id: 'history-future', userId: ordinary, startsAt: new Date(Date.now()+3600000), expiresAt: new Date(until()), grantedById: owner, reason: 'Scheduled' },
    ] })
    const detail = await app.inject({ url: `/admin/users/${ordinary}`, headers: auth(owner) })
    await validateResponse('getAdminUser', 200, detail.json())
    expect(detail.json().data.grants.map((g: any) => g.status).sort()).toEqual(['expired','revoked','scheduled'])
    expect(detail.json().data.availableActions).toContain('revoke_premium')
    const self = await app.inject({ url: `/admin/users/${owner}`, headers: auth(owner) })
    expect(self.json().data.availableActions).not.toContain('suspend')
    const staffTarget = await app.inject({ url: `/admin/users/${owner}`, headers: auth(admin) })
    expect(staffTarget.json().data.availableActions).toEqual([])
  })
  it('previews overlapping grants without writes, and revokes only the selected grant', async () => {
    const longer = new Date(Date.now()+10*86400000).toISOString()
    await change('grant_premium', { expiresAt: longer })
    const longGrant = await db.premiumGrant.findFirstOrThrow({ where: { userId: ordinary } })
    const preview = await app.inject({ method: 'POST', url: `/admin/users/${ordinary}/preview`, headers: auth(owner), payload: { action: 'grant_premium', expiresAt: until(), expectedVersion: 1 } })
    expect(preview.statusCode).toBe(200)
    await validateResponse('previewAdminChange', 200, preview.json())
    expect(preview.json().data.before.expiresAt).toBe(longer)
    expect(preview.json().data.after.expiresAt).toBe(longer)
    expect(await db.adminAuditEvent.count()).toBe(1)
    await change('grant_premium', { expiresAt: until(), expectedVersion: 1 })
    const shortGrant = await db.premiumGrant.findFirstOrThrow({ where: { userId: ordinary, id: { not: longGrant.id } } })
    const revokePreview = await app.inject({ method: 'POST', url: `/admin/users/${ordinary}/preview`, headers: auth(owner), payload: { action: 'revoke_premium', grantId: shortGrant.id, expectedVersion: 2 } })
    expect(revokePreview.json().data.after.expiresAt).toBe(longer)
    expect(revokePreview.json().data.affectedGrantCount).toBe(1)
    expect((await change('revoke_premium', { grantId: shortGrant.id, expectedVersion: 2 })).statusCode).toBe(200)
    expect((await entitlements(ordinary)).expiresAt).toBe(longer)
    expect((await db.premiumGrant.findUniqueOrThrow({ where: { id: longGrant.id } })).revokedAt).toBeNull()
    const audit = await db.adminAuditEvent.findFirstOrThrow({ where: { action: 'revoke_premium' } })
    expect((audit.after as any).changedGrantIds).toEqual([shortGrant.id])
  })
  it('does not allow previews to bypass staff checks or revoke another user’s grant', async () => {
    const preview = (actor: string, input: any) => app.inject({ method: 'POST', url: `/admin/users/${ordinary}/preview`, headers: auth(actor), payload: input })
    expect((await preview(ordinary, { action: 'suspend', expectedVersion: 0 })).statusCode).toBe(403)
    await change('grant_premium', { expiresAt: until() })
    const foreign = await db.premiumGrant.create({ data: { userId: owner, grantedById: owner, expiresAt: new Date(until()), reason: 'Another account' } })
    expect((await preview(owner, { action: 'revoke_premium', expectedVersion: 1, grantId: foreign.id })).statusCode).toBe(409)
    expect((await change('revoke_premium', { expectedVersion: 1, grantId: foreign.id })).statusCode).toBe(409)
    expect((await db.premiumGrant.findUniqueOrThrow({ where: { id: foreign.id } })).revokedAt).toBeNull()
  })
  it('blocks Free Live viewers and leaves Premium Live closed until quotas are ready', async () => {
    const room = await db.room.create({ data: { title: 'Live', ownerId: owner } })
    const token = () => app.inject({ url: `/rooms/${room.id}/live-token`, headers: auth(ordinary) })
    expect((await token()).json().code).toBe('PREMIUM_REQUIRED')
    await change('grant_premium', { expiresAt: until() })
    expect((await token()).json().code).toBe('LIVE_NOT_ENABLED')
    await db.user.update({ where: { id: ordinary }, data: { suspendedAt: new Date() } })
    expect((await token()).statusCode).toBe(403)
  })
})
