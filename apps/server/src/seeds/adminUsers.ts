import { lockAdminMutation } from '../services/admin/lock'
import { db, type MemberStatus, type WorkspaceRole } from '@project/db'

const PREFIX = 'mock-admin-v1-'
const DAY = 86_400_000
export function assertAdminSeedTarget(url = process.env.DATABASE_URL, mode = process.env.NODE_ENV) {
  let target: URL
  try { target = new URL(url ?? '') } catch { throw new Error('A local development/test database is required') }
  if (mode === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !['/voice_chat_dev', '/voice_chat_test'].includes(target.pathname)) {
    throw new Error('Admin fixtures are restricted to local voice_chat_dev or voice_chat_test databases')
  }
}

type Fixture = {
  key: string; name: string; guest?: boolean; suspended?: boolean
  grant?: 'active' | 'expiring' | 'expired' | 'revoked' | 'future'
  role?: WorkspaceRole; status?: MemberStatus; secondWorkspace?: boolean
}
export const adminUserFixtures: readonly Fixture[] = [
  { key: 'alex', name: 'Alex Rivera', grant: 'active', role: 'owner', secondWorkspace: true },
  { key: 'jordan', name: 'Jordan Chen', role: 'admin' },
  { key: 'samira', name: 'Samira Patel', grant: 'active', role: 'member', secondWorkspace: true },
  { key: 'theo', name: 'Theo Brooks', role: 'member' },
  { key: 'maya', name: 'Maya Okafor', grant: 'expiring', role: 'member' },
  { key: 'eli', name: 'Eli Morgan', grant: 'expired', role: 'member' },
  { key: 'noor', name: 'Noor Haddad', grant: 'revoked', role: 'member' },
  { key: 'lucas', name: 'Lucas Silva', grant: 'future', role: 'member' },
  { key: 'priya', name: 'Priya Shah', suspended: true, role: 'member' },
  { key: 'owen', name: 'Owen Williams', suspended: true, grant: 'active', role: 'member' },
  { key: 'ines', name: 'Ines Garcia', grant: 'active', role: 'member', status: 'suspended', secondWorkspace: true },
  { key: 'kai', name: 'Kai Tanaka', role: 'member', status: 'removed' },
  { key: 'riley', name: 'Riley Davis' },
  { key: 'guest', name: 'Guest visitor', guest: true },
]

/** Create-only fixtures: repeat runs never reset an admin edit or extend a grant. */
export async function seedAdminUsers(now = new Date()) {
  assertAdminSeedTarget()
  return db.$transaction(async tx => {
    await lockAdminMutation(tx)
    let created = 0
    const newUsers = new Set<string>()
    for (const fixture of adminUserFixtures) {
      const id = PREFIX + fixture.key
      const email = fixture.guest ? null : `${fixture.key}@admin-fixtures.example.test`
      const existing = await tx.user.findUnique({ where: { id }, select: { id: true } })
      if (existing) continue
      if (email && await tx.user.findUnique({ where: { email }, select: { id: true } })) throw new Error(`Fixture email collision for ${fixture.key}; no changes applied`)
      await tx.user.create({ data: {
        id, email, isGuest: !!fixture.guest, suspendedAt: fixture.suspended ? now : null,
        // Intentionally no password: fixtures cannot authenticate by a shared seed credential.
        profile: { create: { displayName: `[Mock] ${fixture.name}` } },
      } })
      newUsers.add(id)
      created++
      if (fixture.grant) {
        const state = fixture.grant
        await tx.premiumGrant.create({ data: {
          id: PREFIX + fixture.key + '-grant', userId: id, grantedById: 'seed:admin-fixtures-v1',
          startsAt: new Date(now.getTime() + (state === 'future' ? 7 : -14) * DAY),
          expiresAt: new Date(now.getTime() + (state === 'expired' ? -1 : state === 'expiring' ? 1 : 30) * DAY),
          revokedAt: state === 'revoked' ? now : null,
          revokedById: state === 'revoked' ? 'seed:admin-fixtures-v1' : null,
          reason: `Mock ${state} Premium grant for local admin testing`,
        } })
      }
      await tx.adminAuditEvent.create({ data: {
        actorId: 'seed:admin-fixtures-v1', targetUserId: id, action: 'fixture.created',
        reason: 'Create local mock user for admin testing', requestId: PREFIX + fixture.key + '-created',
        before: {}, after: { mock: true, suspended: !!fixture.suspended, premiumGrant: fixture.grant ?? null },
      } })
    }
    // No real account becomes a member/owner of these isolated mock workspaces.
    const ownerId = PREFIX + 'alex'
    for (const [key, name] of [['studio', '[Mock] Fieldwork Studio'], ['collective', '[Mock] Northstar Collective']] as const) {
      await tx.workspace.upsert({ where: { id: PREFIX + key }, create: { id: PREFIX + key, name, slug: PREFIX + key, createdById: ownerId }, update: {} })
    }
    for (const fixture of adminUserFixtures) {
      const userId = PREFIX + fixture.key
      // Never restore membership changes/deletions on repeat runs.
      if (!newUsers.has(userId) || !fixture.role) continue
      await tx.workspaceMember.create({ data: {
        workspaceId: PREFIX + 'studio', userId, role: fixture.role, status: fixture.status ?? 'active',
        removedAt: fixture.status === 'removed' ? now : null,
      } })
      if (fixture.secondWorkspace) await tx.workspaceMember.create({ data: {
        workspaceId: PREFIX + 'collective', userId, role: fixture.key === 'alex' ? 'owner' : 'member',
      } })
    }
    return { created, preserved: adminUserFixtures.length - created, fixtureCount: adminUserFixtures.length }
  })
}
