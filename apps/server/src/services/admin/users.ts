import { lockAdminMutation } from './lock'
import { db, Prisma } from '@project/db'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors'
import { authorizePlatform } from '../authorization/platform'
import { disconnectAccountStreams } from '../authorization/accountStreams'
import { entitlements } from './entitlements'
import { grantAccess, grantStatus } from './grants'
import { stripeBillingConfigured } from './billing'
import { paidAccess, userBilling } from './stripeSync'

export type AdminUserAction = {
  action: 'suspend' | 'reactivate' | 'grant_premium' | 'revoke_premium'
  expectedVersion: number
  reason: string
  expiresAt?: string
  grantId?: string
  confirmed: true
}
export type AdminUserPreview = Omit<AdminUserAction, 'confirmed' | 'reason'>
const select = {
  id: true, email: true, isGuest: true, kind: true, suspendedAt: true, createdAt: true,
  adminVersion: true, profile: { select: { displayName: true } }, platformStaff: { select: { role: true } },
} satisfies Prisma.UserSelect

type Row = Prisma.UserGetPayload<{ select: typeof select }>
async function summary(row: Row, client: Prisma.TransactionClient = db) {
  return {
    id: row.id, email: row.email, displayName: row.profile?.displayName ?? 'Unnamed user',
    isGuest: row.isGuest, kind: row.kind, suspendedAt: row.suspendedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), version: row.adminVersion,
    staffRole: row.platformStaff?.role ?? null, premium: await entitlements(row.id, client),
  }
}
async function availableActions(actorId: string, role: string, target: Row, hasGrants: boolean, client: Prisma.TransactionClient) {
  const actions: AdminUserAction['action'][] = []
  if (target.kind !== 'human' || (target.platformStaff && role !== 'platform_owner')) return actions
  if (target.suspendedAt) actions.push('reactivate')
  else if (actorId !== target.id) {
    const anotherOwner = target.platformStaff?.role !== 'platform_owner' || await client.platformStaff.count({ where: {
      role: 'platform_owner', userId: { not: target.id }, user: { suspendedAt: null, deletedAt: null, isGuest: false, kind: 'human' },
    } }) > 0
    if (anotherOwner) actions.push('suspend')
  }
  if (!target.isGuest) actions.push('grant_premium')
  if (hasGrants) actions.push('revoke_premium')
  return actions
}
export async function listAdminUsers(actorId: string, query: { q?: string; cursor?: string }) {
  await authorizePlatform(actorId, 'users.read')
  const q = query.q?.trim()
  const rows = await db.user.findMany({
    where: { deletedAt: null, ...(query.cursor ? { id: { gt: query.cursor } } : {}), ...(q ? {
      OR: [{ id: q }, { email: { contains: q } }, { profile: { displayName: { contains: q } } }],
    } : {}) },
    select, orderBy: { id: 'asc' }, take: 31,
  })
  return { data: await Promise.all(rows.slice(0, 30).map(row => summary(row))), nextCursor: rows.length > 30 ? rows[29]!.id : null }
}
export async function adminUserDetail(actorId: string, userId: string) {
  const actor = await authorizePlatform(actorId, 'users.read')
  const user = await db.user.findFirst({ where: { id: userId, deletedAt: null }, select })
  if (!user) throw notFound('User not found')
  const now = new Date()
  const [memberships, activity, grants, grantCount, revocableCount] = await Promise.all([
    db.workspaceMember.findMany({ where: { userId }, select: { id: true, role: true, status: true, workspace: { select: { id: true, name: true } } }, orderBy: { joinedAt: 'desc' } }),
    db.adminAuditEvent.findMany({ where: { targetUserId: userId }, select: { id: true, action: true, reason: true, createdAt: true, actorId: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }),
    db.premiumGrant.findMany({ where: { userId }, orderBy: [{ startsAt: 'desc' }, { id: 'desc' }], take: 50 }),
    db.premiumGrant.count({ where: { userId } }),
    db.premiumGrant.count({ where: { userId, revokedAt: null, expiresAt: { gt: now } } }),
  ])
  return { ...await summary(user), memberships, activity,
    grants: grants.map(g => ({ id: g.id, startsAt: g.startsAt, expiresAt: g.expiresAt, revokedAt: g.revokedAt, reason: g.reason, status: grantStatus(g, now) })),
    grantCount, availableActions: await availableActions(actorId, actor.role, user, revocableCount > 0, db),
    billingConfigured: stripeBillingConfigured(), billing: await userBilling(userId),
  }
}
async function prepareChange(actorId: string, userId: string, input: AdminUserPreview, client: Prisma.TransactionClient) {
  const actor = await authorizePlatform(actorId, 'users.manage', client)
  const target = await client.user.findFirst({ where: { id: userId, deletedAt: null }, select })
  if (!target) throw notFound('User not found')
  if (target.adminVersion !== input.expectedVersion) throw conflict('This user changed. Close the dialog, reload, and confirm again.', 'STALE_CONFIRMATION')
  const now = new Date()
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  if (input.action === 'grant_premium' && (!expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt <= now || expiresAt.getTime() > now.getTime() + 366 * 86400000)) {
    throw badRequest('Choose a Premium expiry within the next year', 'INVALID_EXPIRY')
  }
  if (input.action !== 'grant_premium' && input.expiresAt) throw badRequest('Expiry is only valid for a new grant')
  if (input.action !== 'revoke_premium' && input.grantId) throw badRequest('A grant ID is only valid for revocation')
  if (input.action === 'suspend' && userId === actorId) throw badRequest('You cannot suspend yourself', 'SELF_SUSPEND')
  if (input.action === 'grant_premium' && target.isGuest) throw badRequest('The user must register before receiving Premium', 'REGISTERED_ACCOUNT_REQUIRED')
  const grants = await client.premiumGrant.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: now } } })
  if (!(await availableActions(actorId, actor.role, target, grants.length > 0, client)).includes(input.action)) throw forbidden('This action is not available for this account')
  const affected = input.action === 'revoke_premium' ? grants.filter(g => !input.grantId || g.id === input.grantId) : []
  if (input.action === 'revoke_premium' && !affected.length) throw conflict('That grant is no longer available. Reload the user.', 'GRANT_UNAVAILABLE')
  const afterGrants = input.action === 'grant_premium'
    ? [...grants, { id: 'preview', startsAt: now, expiresAt: expiresAt!, revokedAt: null }]
    : grants.filter(g => !affected.some(a => a.id === g.id))
  const eligible = !target.isGuest && target.kind === 'human'
  const paid = eligible ? await paidAccess(userId, client, now) : null
  const access = (items: typeof afterGrants) => {
    const grant = grantAccess(items, now, eligible)
    const expiry = [grant.expiresAt, paid?.accessUntil?.toISOString()].filter((d): d is string => !!d).sort().reverse()[0]
    return { tier: expiry ? 'premium' as const : 'free' as const, expiresAt: expiry ?? null }
  }
  const before = { account: target.suspendedAt ? 'suspended' as const : 'active' as const, ...access(grants) }
  const after = { account: input.action === 'suspend' ? 'suspended' as const : input.action === 'reactivate' ? 'active' as const : before.account, ...access(afterGrants) }
  return { target, expiresAt, now, affected, preview: {
    before, after, affectedGrantCount: input.action === 'grant_premium' ? 1 : affected.length,
    effectiveAt: now.toISOString(), billingImpact: 'No charge, refund, or subscription change. Existing Stripe billing, if any, continues.',
    liveImpact: 'Live stays disabled for everyone until usage limits are set.',
  } }
}
export async function previewAdminUserChange(actorId: string, userId: string, input: AdminUserPreview) {
  return (await prepareChange(actorId, userId, input, db)).preview
}
export async function changeAdminUser(actorId: string, userId: string, input: AdminUserAction, requestId: string) {
  const reason = input.reason.trim()
  if (!input.confirmed || reason.length < 3 || reason.length > 500) throw badRequest('Confirm the change and provide a reason (3–500 characters)', 'CONFIRMATION_REQUIRED')
  await db.$transaction(async tx => {
    await lockAdminMutation(tx)
    const { now, expiresAt, affected, preview } = await prepareChange(actorId, userId, input, tx)
    const grantFact = (g: { id: string; startsAt: Date; expiresAt: Date; revokedAt: Date | null }) => ({ id: g.id, startsAt: g.startsAt.toISOString(), expiresAt: g.expiresAt.toISOString(), revokedAt: g.revokedAt?.toISOString() ?? null })
    const beforeGrants = affected.map(grantFact)
    let afterGrants = affected.map(g => grantFact({ ...g, revokedAt: now }))
    let changedGrantIds = affected.map(g => g.id)
    if (input.action === 'grant_premium') {
      const grant = await tx.premiumGrant.create({ data: { userId, startsAt: now, expiresAt: expiresAt!, grantedById: actorId, reason } })
      changedGrantIds = [grant.id]
      afterGrants = [grantFact(grant)]
    }
    if (input.action === 'revoke_premium') await tx.premiumGrant.updateMany({ where: { userId, id: { in: changedGrantIds } }, data: { revokedAt: now, revokedById: actorId } })
    await tx.user.update({ where: { id: userId }, data: {
      adminVersion: { increment: 1 },
      ...(input.action === 'suspend' ? { suspendedAt: now } : {}),
      ...(input.action === 'reactivate' ? { suspendedAt: null } : {}),
    } })
    if (input.action === 'suspend') await tx.session.deleteMany({ where: { userId } })
    await tx.adminAuditEvent.create({ data: {
      actorId, targetUserId: userId, action: input.action, reason, requestId,
      before: { ...preview.before, version: input.expectedVersion, grants: beforeGrants },
      after: { ...preview.after, version: input.expectedVersion + 1, changedGrantIds, grants: afterGrants },
    } })
  })
  if (input.action === 'suspend') disconnectAccountStreams(userId)
  return adminUserDetail(actorId, userId)
}
