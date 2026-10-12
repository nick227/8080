import { type PremiumGrant } from '@project/db'

export type GrantFact = Pick<PremiumGrant, 'id' | 'startsAt' | 'expiresAt' | 'revokedAt'>
export function grantStatus(grant: GrantFact, now: Date) {
  if (grant.revokedAt) return 'revoked' as const
  if (grant.expiresAt <= now) return 'expired' as const
  return grant.startsAt > now ? 'scheduled' as const : 'active' as const
}
export function grantAccess(grants: GrantFact[], now: Date, eligible = true) {
  const active = eligible ? grants.filter(g => grantStatus(g, now) === 'active').sort((a,b) => b.expiresAt.getTime()-a.expiresAt.getTime()) : []
  return { tier: active.length ? 'premium' as const : 'free' as const, expiresAt: active[0]?.expiresAt.toISOString() ?? null }
}
