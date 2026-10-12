import { describe, expect, it } from 'vitest'
import { db } from '@project/db'
import { assertAdminSeedTarget, seedAdminUsers, adminUserFixtures } from '../seeds/adminUsers'
import { entitlements } from '../services/admin/entitlements'

describe('local admin user fixtures', () => {
  it('refuses production, remote databases, and non-development database names', () => {
    expect(() => assertAdminSeedTarget('mysql://user:password@localhost/voice_chat_dev', 'production')).toThrow()
    expect(() => assertAdminSeedTarget('mysql://user:password@remote.example/voice_chat_dev', 'development')).toThrow()
    expect(() => assertAdminSeedTarget('mysql://user:password@localhost/production', 'development')).toThrow()
    expect(() => assertAdminSeedTarget('mysql://user:password@localhost/voice_chat_test', 'test')).not.toThrow()
  })
  it('creates varied personal and workspace states without staff or login credentials; reruns preserve changes', async () => {
    const now = new Date()
    const result = await seedAdminUsers(now)
    expect(result.created).toBe(adminUserFixtures.length)
    expect(await db.platformStaff.count()).toBe(0)
    expect(await db.user.count({ where: { passwordHash: { not: null } } })).toBe(0)
    expect((await entitlements('mock-admin-v1-alex')).tier).toBe('premium')
    for (const key of ['theo', 'eli', 'noor', 'lucas', 'guest']) expect((await entitlements(`mock-admin-v1-${key}`)).tier).toBe('free')
    const ines = await db.workspaceMember.findMany({ where: { userId: 'mock-admin-v1-ines' } })
    expect(ines.map(m => m.status).sort()).toEqual(['active', 'suspended'])
    await db.user.update({ where: { id: 'mock-admin-v1-theo' }, data: { suspendedAt: now, profile: { update: { displayName: 'Edited by an admin' } } } })
    await db.premiumGrant.update({ where: { id: 'mock-admin-v1-alex-grant' }, data: { revokedAt: now } })
    const before = await db.premiumGrant.findUniqueOrThrow({ where: { id: 'mock-admin-v1-alex-grant' } })
    const auditCount = await db.adminAuditEvent.count()
    expect((await seedAdminUsers(new Date(now.getTime()+7*86400000))).created).toBe(0)
    expect(await db.user.count()).toBe(adminUserFixtures.length)
    expect(await db.adminAuditEvent.count()).toBe(auditCount)
    expect(await db.premiumGrant.findUnique({ where: { id: before.id } })).toEqual(before)
    expect((await db.user.findUniqueOrThrow({ where: { id: 'mock-admin-v1-theo' }, include: { profile: true } })).profile?.displayName).toBe('Edited by an admin')
  })
})
