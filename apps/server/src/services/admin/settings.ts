import { lockAdminMutation } from './lock'
import { db } from '@project/db'
import { badRequest, conflict, notFound } from '../../lib/errors'
import { authorizePlatform } from '../authorization/platform'
import { premiumPrices, stripeMode, syncConfigured } from './stripeSync'

export async function adminSettings(actorId: string) {
  const actor = await authorizePlatform(actorId, 'users.read')
  const staff = await db.platformStaff.findMany({ include: { user: { select: { id: true, email: true, adminVersion: true, suspendedAt: true, profile: { select: { displayName: true } } } } }, orderBy: { createdAt: 'asc' } })
  const last = await db.stripeWebhookReceipt.findFirst({ orderBy: { processedAt: 'desc' } })
  return { canManage: actor.role === 'platform_owner', staff: staff.map(s => ({ userId: s.userId, canChange: actor.role === 'platform_owner' && s.userId !== actorId, email: s.user.email, displayName: s.user.profile?.displayName ?? 'Unnamed user', role: s.role, version: s.user.adminVersion, suspended: !!s.user.suspendedAt })),
    billing: { configured: syncConfigured(), mode: stripeMode() === null ? null : stripeMode() ? 'live' : 'test', premiumPriceCount: premiumPrices().length, webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET, lastEventAt: last?.processedAt.toISOString() ?? null },
    live: { enabled: false, reason: 'Premium Live remains disabled until usage and concurrency limits are decided.' },
    checkout: { enabled: false, reason: 'Recurring pricing and checkout are not enabled.' },
  }
}
export async function changeStaff(actorId: string, userId: string, input: { role: 'platform_admin' | 'platform_owner' | null; expectedVersion: number; reason: string; confirmed: boolean }, requestId: string) {
  if (!input.confirmed || input.reason.trim().length < 3 || input.reason.trim().length > 500) throw badRequest('Confirm with a reason (3–500 characters)')
  await authorizePlatform(actorId, 'staff.manage')
  if (actorId === userId) throw badRequest('You cannot change your own staff role')
  await db.$transaction(async tx => {
    await lockAdminMutation(tx)
    await authorizePlatform(actorId, 'staff.manage', tx)
    const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null, isGuest: false, kind: 'human' }, include: { platformStaff: true } })
    if (!user) throw notFound('Registered user not found')
    if (user.adminVersion !== input.expectedVersion) throw conflict('This user changed. Reload before confirming.', 'STALE_CONFIRMATION')
    if (input.role && user.suspendedAt) throw badRequest('Reactivate this account before assigning staff access')
    const oldRole = user.platformStaff?.role ?? null
    if (oldRole === input.role) throw conflict('The user already has this role')
    if (oldRole === 'platform_owner' && input.role !== 'platform_owner') {
      const others = await tx.platformStaff.count({ where: { role: 'platform_owner', userId: { not: userId }, user: { deletedAt: null, suspendedAt: null, isGuest: false, kind: 'human' } } })
      if (!others) throw conflict('Keep at least one active platform owner')
    }
    if (input.role) await tx.platformStaff.upsert({ where: { userId }, create: { userId, role: input.role, grantedById: actorId }, update: { role: input.role, grantedById: actorId } })
    else await tx.platformStaff.delete({ where: { userId } })
    await tx.user.update({ where: { id: userId }, data: { adminVersion: { increment: 1 } } })
    await tx.adminAuditEvent.create({ data: { actorId, targetUserId: userId, action: 'staff.change', reason: input.reason.trim(), requestId, before: { role: oldRole, version: input.expectedVersion }, after: { role: input.role, version: input.expectedVersion + 1 } } })
  })
  return adminSettings(actorId)
}
