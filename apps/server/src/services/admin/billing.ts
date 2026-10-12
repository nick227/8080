import { db } from '@project/db'
import { httpError } from '../../lib/errors'
import { authorizePlatform } from '../authorization/platform'

// Explicit restricted key; never fall back to a write-capable secret key.
export const stripeBillingConfigured = () => !!process.env.STRIPE_READONLY_KEY
export const STRIPE_READ_VERSION = '2026-09-30.endive'
type StripeObject = Record<string, any>
const object = (value: unknown): StripeObject | null => value && typeof value === 'object' && !Array.isArray(value) ? value as StripeObject : null
const iso = (seconds: unknown) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  const date = new Date(seconds * 1000)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export async function listAdminSubscriptions(actorId: string, query: { cursor?: string; status?: string }) {
  await authorizePlatform(actorId, 'billing.read')
  const key = process.env.STRIPE_READONLY_KEY
  if (!key) return { configured: false, mode: null, fetchedAt: null, data: [], nextCursor: null }
  if (!/^rk_(test|live)_[A-Za-z0-9]+$/.test(key)) throw httpError(503, 'Configure a Stripe restricted key for read-only billing', 'BILLING_CONFIGURATION')
  const mode = key.startsWith('rk_live_') ? 'live' : 'test'
  const params = new URLSearchParams({ limit: '25', status: query.status ?? 'all', 'expand[]': 'data.latest_invoice' })
  if (query.cursor) params.set('starting_after', query.cursor)
  let payload: StripeObject | null
  try {
    const response = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
      method: 'GET', headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_READ_VERSION },
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw httpError(503, 'Stripe rejected the billing credentials or read permissions', 'BILLING_CONFIGURATION')
      if (response.status === 429) throw httpError(503, 'Stripe is busy. Try again shortly.', 'BILLING_UNAVAILABLE')
      throw httpError(502, 'Stripe billing could not be loaded. Refresh to try again.', 'BILLING_UNAVAILABLE')
    }
    payload = object(await response.json())
  } catch (error) {
    if (object(error)?.statusCode) throw error
    // Never relay upstream payloads, request headers, or credentials to the client.
    throw httpError(502, 'Stripe billing could not be loaded. Refresh to try again.', 'BILLING_UNAVAILABLE')
  }
  if (!payload || !Array.isArray(payload.data) || typeof payload.has_more !== 'boolean') throw httpError(502, 'Stripe returned an unexpected billing response', 'BILLING_UNAVAILABLE')
  const subscriptions: StripeObject[] = payload.data.map((value: unknown) => {
    const sub = object(value)
    if (!sub || typeof sub.id !== 'string' || !/^sub_[A-Za-z0-9]+$/.test(sub.id) || typeof sub.status !== 'string' || sub.livemode !== (mode === 'live')) throw httpError(502, 'Stripe returned an unexpected billing response', 'BILLING_UNAVAILABLE')
    return sub
  })
  const userIds = subscriptions.flatMap(sub => typeof sub.metadata?.['8080_user_id'] === 'string' ? [sub.metadata['8080_user_id']] : [])
  const users = await db.user.findMany({ where: { id: { in: userIds }, deletedAt: null }, select: { id: true, email: true, profile: { select: { displayName: true } } } })
  const data = subscriptions.map(sub => {
    const user = users.find(u => u.id === sub.metadata?.['8080_user_id'])
    const invoice = object(sub.latest_invoice)
    const items: StripeObject[] = Array.isArray(sub.items?.data) ? sub.items.data.map(object).filter((item: StripeObject | null): item is StripeObject => !!item) : []
    const periodEnds = items.map(item => iso(item.current_period_end)).filter((v): v is string => !!v).sort()
    const ended = sub.status === 'canceled' || sub.status === 'incomplete_expired'
    const scheduledEnd = iso(sub.cancel_at)
    const canceling = !ended && (sub.cancel_at_period_end === true || !!scheduledEnd)
    const periods = items.map(item => object(item.price?.recurring)).filter((p): p is StripeObject => !!p && ['day', 'week', 'month', 'year'].includes(p.interval) && Number.isInteger(p.interval_count) && p.interval_count > 0)
    const intervals = [...new Set(periods.map(p => `${p.interval_count ?? 1} ${p.interval}`))]
    const customer = typeof sub.customer === 'string' ? sub.customer : object(sub.customer)?.id
    return {
      id: sub.id as string, customerId: typeof customer === 'string' ? customer : null,
      user: user ? { id: user.id, displayName: user.profile?.displayName ?? 'Unnamed user', email: user.email } : null,
      status: sub.status as string, invoiceStatus: typeof invoice?.status === 'string' ? invoice.status : null,
      interval: intervals.length === 1 ? intervals[0]! : intervals.length ? 'Mixed intervals' : 'Unknown',
      dateLabel: ended ? 'Ended' : canceling ? 'Ends' : sub.status === 'paused' ? 'Paused' : 'Period ends',
      date: ended ? iso(sub.ended_at) : canceling ? scheduledEnd ?? periodEnds[0] ?? null : sub.status === 'paused' ? null : periodEnds[0] ?? null,
      dashboardUrl: `https://dashboard.stripe.com/${mode === 'test' ? 'test/' : ''}subscriptions/${sub.id}`,
    }
  })
  return { configured: true, mode, fetchedAt: new Date().toISOString(), data,
    nextCursor: payload.has_more && data.length ? data[data.length - 1]!.id : null }
}
