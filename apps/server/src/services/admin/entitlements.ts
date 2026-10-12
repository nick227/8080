import { db, type Prisma } from '@project/db'
import { paidAccess } from './stripeSync'

// Grants and paid subscriptions are independent, user-owned sources.
export async function entitlements(userId: string, client: Prisma.TransactionClient = db, now = new Date()) {
  const user = await client.user.findUniqueOrThrow({ where: { id: userId } })
  const grant = !user.isGuest && user.kind === 'human' && !user.deletedAt
    ? await client.premiumGrant.findFirst({
      where: { userId, revokedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
    }) : null
  const paid = !user.isGuest && user.kind === 'human' && !user.deletedAt ? await paidAccess(userId, client, now) : null
  const premium = !!grant || !!paid
  const expiresAt = [grant?.expiresAt, paid?.accessUntil].filter((d): d is Date => !!d).sort((a,b) => b.getTime() - a.getTime())[0]
  return {
    tier: premium ? 'premium' as const : 'free' as const,
    source: paid ? grant ? 'grant_and_stripe' as const : 'stripe' as const : grant ? 'grant' as const : null,
    expiresAt: expiresAt?.toISOString() ?? null,
    // Fail closed until durable usage limits and active-session removal ship.
    liveAvailable: false,
    liveUnavailableReason: premium ? 'Premium Live is paused until usage limits are set.' : 'Premium is required for Live.',
  }
}
