// Web Push for the /native/ app. Not another event pipeline: releaseInbox (inboxHub)
// hands over every inbox row the moment it becomes visible to its member, and this
// sends that member's own row to the devices they enabled. Disabled without VAPID keys.
import webpush from 'web-push'
import { db } from '@project/db'
import { badRequest, forbidden } from '../lib/errors'
import type { InboxItemView } from './inboxFanOut'

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } }
type Send = (target: PushTarget, payload: string) => Promise<unknown>

/** Tests capture pushes here instead of calling a push service. */
let override: Send | null = null
export function setPushSender(send: Send | null) {
  override = send
}

function vapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject: subject() }
}

// Push services want a contact: VAPID_SUBJECT, else the app's https address, else the platform sender.
function subject() {
  const explicit = process.env.VAPID_SUBJECT?.trim()
  if (explicit) return explicit
  const app = (process.env.APP_URL ?? '').split(',')[0]?.trim()
  if (app?.startsWith('https://')) return app
  const from = process.env.EMAIL_PLATFORM_FROM?.match(/[^<\s]+@[^>\s]+/)?.[0]
  return from ? `mailto:${from}` : 'mailto:push@localhost'
}

export function pushPublicKey() {
  return vapid()?.publicKey ?? null
}

function sender(): Send | null {
  if (override) return override
  const keys = vapid()
  if (!keys) return null
  return (target, payload) => webpush.sendNotification(target, payload, { TTL: 24 * 3600, urgency: 'normal', vapidDetails: keys })
}

// The server POSTs to whatever endpoint a browser registered, so only the browsers'
// push services are accepted (Chrome/Edge/Opera, Apple, Mozilla, Windows).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/]

function checkTarget(input: PushTarget) {
  let url: URL
  try { url = new URL(input.endpoint) } catch { throw badRequest('Not a push endpoint', 'INVALID_PUSH_ENDPOINT') }
  if (url.protocol !== 'https:' || url.port || !PUSH_HOSTS.some((host) => host.test(url.hostname))) throw badRequest('Not a supported push service', 'INVALID_PUSH_ENDPOINT')
}

const gone = (err: unknown) => {
  const status = (err as { statusCode?: number }).statusCode
  return status === 404 || status === 410
}

async function deliver(subs: { id: string; endpoint: string; p256dh: string; auth: string }[], payload: string, send: Send) {
  let sent = 0
  let removed = 0
  await Promise.all(subs.map(async (sub) => {
    try {
      await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
      sent++
      await db.pushSubscription.updateMany({ where: { id: sub.id }, data: { lastSuccessAt: new Date() } })
    } catch (err) {
      // Expired or revoked in the browser: forget the device.
      if (gone(err)) {
        removed++
        await db.pushSubscription.deleteMany({ where: { id: sub.id } })
      } else {
        console.warn('[push] delivery failed', (err as { statusCode?: number }).statusCode ?? (err as Error).message)
      }
    }
  }))
  return { sent, removed }
}

export class PushService {
  async subscribe(user: { id: string; isGuest: boolean }, input: PushTarget & { userAgent?: string }) {
    if (user.isGuest) throw forbidden('Sign in to turn on notifications')
    checkTarget(input)
    // The same device signed in as someone else now belongs to them.
    const data = { userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent?.slice(0, 200) ?? null }
    const row = await db.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data })
    return { endpoint: row.endpoint, createdAt: row.createdAt.toISOString() }
  }

  async unsubscribe(userId: string, endpoint: string) {
    await db.pushSubscription.deleteMany({ where: { userId, endpoint } })
  }

  /** A visible check from Settings that this device really receives pushes. */
  async test(userId: string) {
    const send = sender()
    if (!send) throw badRequest('Push notifications are not configured on this server', 'PUSH_DISABLED')
    const subs = await db.pushSubscription.findMany({ where: { userId } })
    const payload = JSON.stringify({ title: 'Notifications are on', body: 'You’ll hear from your workspaces here.', tag: 'push-test', url: '/native/settings' })
    return deliver(subs, payload, send)
  }
}

// Conversation rows exist once per workspace a room member belongs to; one push per message.
const recent = new Map<string, number>()
function firstTime(key: string) {
  const now = Date.now()
  for (const [k, at] of recent) if (now - at > 10 * 60_000) recent.delete(k)
  if (recent.has(key)) return false
  recent.set(key, now)
  return true
}

/** Called for every inbox row when it becomes visible (inboxHub.releaseInbox). */
export async function pushInboxItem(item: InboxItemView) {
  if (!item.unread || item.archivedAt) return
  const send = sender()
  if (!send) return
  // Claim once: a repeated release of the same row (idempotent raise, retries) never pushes again.
  const claimed = await db.inboxItem.updateMany({ where: { id: item.id, pushedAt: null, unread: true, archivedAt: null }, data: { pushedAt: new Date() } })
  if (!claimed.count) return
  // Still a member right now (access may have been revoked since the row was written).
  const member = await db.workspaceMember.findFirst({
    where: { id: item.memberId, workspaceId: item.workspaceId, status: 'active', workspace: { deletedAt: null }, user: { isGuest: false } },
    select: { userId: true, workspace: { select: { name: true } } },
  })
  if (!member) return
  if (item.sourceType === 'conversation' && !firstTime(`${member.userId}:${item.dedupeKey}`)) return
  const subs = await db.pushSubscription.findMany({ where: { userId: member.userId } })
  if (!subs.length) return
  const payload = JSON.stringify({
    title: item.title,
    body: item.summary && item.summary !== item.title ? `${member.workspace.name} · ${item.summary}` : member.workspace.name,
    // A busy room replaces its previous notification instead of stacking.
    tag: item.sourceType === 'conversation' ? `room:${item.sourceId}` : `inbox:${item.id}`,
    url: `/native/?open=${encodeURIComponent(item.id)}&w=${encodeURIComponent(item.workspaceId)}`,
  })
  await deliver(subs, payload, send)
}
