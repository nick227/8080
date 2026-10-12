import { lockAdminMutation } from './lock'
import Stripe from 'stripe'
import { db, type Prisma } from '@project/db'
import { badRequest, conflict, httpError, notFound } from '../../lib/errors'
import { authorizePlatform } from '../authorization/platform'
import { STRIPE_READ_VERSION } from './billing'

export function stripeMode() {
  const key = process.env.STRIPE_READONLY_KEY ?? ''
  return /^rk_live_[A-Za-z0-9]+$/.test(key) ? true : /^rk_test_[A-Za-z0-9]+$/.test(key) ? false : null
}
export const premiumPrices = () => (process.env.STRIPE_PREMIUM_PRICE_IDS ?? '').split(',').map(s => s.trim()).filter(s => /^price_[A-Za-z0-9]+$/.test(s))
export const syncConfigured = () => stripeMode() !== null && !!process.env.STRIPE_WEBHOOK_SECRET && premiumPrices().length > 0
export async function stripeRead(path: string): Promise<any> {
  if (stripeMode() === null) throw httpError(503, 'Configure the restricted Stripe billing key', 'BILLING_CONFIGURATION')
  try {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000), headers: {
      Authorization: `Bearer ${process.env.STRIPE_READONLY_KEY}`, 'Stripe-Version': STRIPE_READ_VERSION,
    } })
    if (!response.ok) throw new Error('provider unavailable')
    return await response.json()
  } catch {
    throw httpError(502, 'Stripe could not be verified. Retry the operation.', 'BILLING_UNAVAILABLE')
  }
}
export async function paidAccess(userId: string, client: Prisma.TransactionClient = db, now = new Date()) {
  const mode = stripeMode()
  if (mode === null || (process.env.NODE_ENV === 'production' && !mode) || !premiumPrices().length) return null
  const binding = await client.stripeCustomerBinding.findUnique({ where: { userId } })
  if (!binding || binding.livemode !== mode) return null
  return client.stripeSubscription.findFirst({ where: {
    customerId: binding.customerId, livemode: mode, syncedAt: { gte: binding.createdAt }, status: 'active', invoiceStatus: 'paid',
    priceId: { in: premiumPrices() }, accessUntil: { gt: now },
  }, orderBy: { accessUntil: 'desc' } })
}
export async function userBilling(userId: string, client: Prisma.TransactionClient = db) {
  const binding = await client.stripeCustomerBinding.findUnique({ where: { userId } })
  const subscriptions = binding ? await client.stripeSubscription.findMany({ where: { customerId: binding.customerId }, orderBy: { syncedAt: 'desc' }, take: 20 }) : []
  return { customerId: binding?.customerId ?? null, mode: binding ? binding.livemode ? 'live' : 'test' : null,
    subscriptions: subscriptions.map(s => ({ id: s.id, status: s.status, invoiceStatus: s.invoiceStatus, accessUntil: s.accessUntil?.toISOString() ?? null, syncedAt: s.syncedAt.toISOString() })) }
}
const states = ['active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused']
function normalized(sub: any, id: string) {
  if (!sub || sub.id !== id || sub.livemode !== stripeMode() || !states.includes(sub.status) || typeof sub.customer !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(sub.customer) || !Array.isArray(sub.items?.data)) {
    throw httpError(502, 'Stripe returned an unexpected subscription', 'BILLING_UNAVAILABLE')
  }
  const invoice = sub.latest_invoice
  const items = sub.items.data.filter((item: any) => item?.price?.type === 'recurring' && item?.price?.recurring && premiumPrices().includes(item.price.id))
  // Multiple matching items are ambiguous. No trials, dunning grace, paused collection,
  // or unrelated prices grant access. Never infer payment from subscription status alone.
  const item = items.length === 1 && sub.items.has_more !== true ? items[0] : null
  const seconds = item?.current_period_end
  let until = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null
  if (until && !Number.isFinite(until.getTime())) until = null
  if (until && typeof sub.cancel_at === 'number') until = new Date(Math.min(until.getTime(), sub.cancel_at * 1000))
  const invoiceSub = invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription
  const validInvoice = invoice && typeof invoice === 'object' && invoice.status === 'paid' && invoice.customer === sub.customer && invoiceSub === id && invoice.livemode === sub.livemode
  return { id, customerId: sub.customer as string, livemode: sub.livemode as boolean, status: sub.status as string,
    invoiceStatus: typeof invoice?.status === 'string' && invoice.status.length <= 40 ? invoice.status as string : null,
    priceId: item?.price.id as string | undefined ?? null,
    accessUntil: sub.status === 'active' && validInvoice && !sub.pause_collection && until && Number.isFinite(until.getTime()) ? until : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true, syncedAt: new Date() }
}
function snapshot(value: any) { return value ? JSON.parse(JSON.stringify(value)) : {} }
// The DB lock is held before fetching provider state, so concurrent/out-of-order
// notifications cannot fetch an older state and overwrite a later reconciliation.
async function syncOne(tx: Prisma.TransactionClient, id: string, actorId: string, reason: string, requestId: string) {
  if (!/^sub_[A-Za-z0-9]+$/.test(id)) throw badRequest('Invalid subscription ID')
  const sub = normalized(await stripeRead(`subscriptions/${id}?expand[]=latest_invoice`), id)
  const before = await tx.stripeSubscription.findUnique({ where: { id } })
  if (before && (before.customerId !== sub.customerId || before.livemode !== sub.livemode)) throw conflict('The subscription customer or mode changed unexpectedly')
  await tx.stripeSubscription.upsert({ where: { id }, create: sub, update: sub })
  const binding = await tx.stripeCustomerBinding.findUnique({ where: { customerId: sub.customerId } })
  if (binding && binding.livemode === sub.livemode) await tx.user.updateMany({ where: { id: binding.userId }, data: { adminVersion: { increment: 1 } } })
  await tx.adminAuditEvent.create({ data: { actorId, targetUserId: binding?.userId ?? 'unlinked', action: 'billing.sync', reason, requestId, before: snapshot(before), after: snapshot(sub) } })
  return sub
}
export async function reconcileSubscription(actorId: string, id: string, input: { confirmed: boolean; reason: string }, requestId: string) {
  if (!input.confirmed || input.reason.trim().length < 3 || input.reason.trim().length > 500) throw badRequest('Confirm with a reason (3–500 characters)')
  await authorizePlatform(actorId, 'billing.manage')
  await db.$transaction(async tx => {
    await lockAdminMutation(tx)
    await authorizePlatform(actorId, 'billing.manage', tx)
    await syncOne(tx, id, actorId, input.reason.trim(), requestId)
  }, { timeout: 15000, maxWait: 15000 })
  return { synchronized: true }
}
export async function linkCustomer(actorId: string, userId: string, input: { customerId: string; expectedVersion: number; confirmed: boolean; reason: string }, requestId: string) {
  await authorizePlatform(actorId, 'billing.manage')
  if (!input.confirmed || input.reason.trim().length < 3 || input.reason.trim().length > 500 || !/^cus_[A-Za-z0-9]+$/.test(input.customerId)) throw badRequest('Confirm an exact Stripe customer ID and provide a reason')
  await db.$transaction(async tx => {
    await lockAdminMutation(tx)
    await authorizePlatform(actorId, 'billing.manage', tx)
    const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null, isGuest: false, kind: 'human' } })
    if (!user) throw notFound('Registered user not found')
    if (user.adminVersion !== input.expectedVersion) throw conflict('This user changed. Reload before confirming.', 'STALE_CONFIRMATION')
    if (await tx.stripeCustomerBinding.findFirst({ where: { OR: [{ userId }, { customerId: input.customerId }] } })) throw conflict('User or customer is already linked; reassignment is not supported')
    const customer = await stripeRead(`customers/${input.customerId}`)
    if (customer.id !== input.customerId || customer.deleted || customer.livemode !== stripeMode()) throw badRequest('Customer is unavailable in the configured Stripe mode')
    await tx.stripeCustomerBinding.create({ data: { userId, customerId: input.customerId, livemode: customer.livemode } })
    await tx.user.update({ where: { id: userId }, data: { adminVersion: { increment: 1 } } })
    await tx.adminAuditEvent.create({ data: { actorId, targetUserId: userId, action: 'billing.link', reason: input.reason.trim(), requestId, before: {}, after: { customerId: input.customerId, livemode: customer.livemode } } })
  }, { timeout: 15000, maxWait: 15000 })
  return userBilling(userId)
}
export async function receiveStripeWebhook(raw: Buffer, signature: string | undefined) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || stripeMode() === null) throw httpError(503, 'Stripe synchronization is not configured', 'BILLING_CONFIGURATION')
  let event: Stripe.Event
  try {
    // SDK verifies timestamp tolerance and signature over the original bytes.
    event = Stripe.webhooks.constructEvent(raw, signature ?? '', secret)
  } catch { throw badRequest('Invalid Stripe signature', 'INVALID_SIGNATURE') }
  if (event.livemode !== stripeMode() || event.account || !/^evt_[A-Za-z0-9]+$/.test(event.id)) throw badRequest('Unexpected Stripe event account or mode')
  const supported = ['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed', 'invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.marked_uncollectible','invoice.voided']
  if (!supported.includes(event.type)) return { received: true }
  const obj = event.data.object as any
  const subscriptionId = event.type.startsWith('customer.subscription.') ? obj.id : obj.parent?.subscription_details?.subscription ?? obj.subscription
  if (!subscriptionId && event.type.startsWith('invoice.')) return { received: true }
  if (typeof subscriptionId !== 'string' || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) throw badRequest('Missing subscription ID')
  await db.$transaction(async tx => {
    await lockAdminMutation(tx)
    if (await tx.stripeWebhookReceipt.findUnique({ where: { id: event.id } })) return
    await syncOne(tx, subscriptionId, 'stripe', `Stripe ${event.type}`, `stripe:${event.id}`)
    await tx.stripeWebhookReceipt.create({ data: { id: event.id, type: event.type } })
  }, { timeout: 15000, maxWait: 15000 })
  return { received: true }
}
