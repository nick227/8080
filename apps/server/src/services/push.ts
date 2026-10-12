// Web Push for the /native/ app. Not another event pipeline: releaseInbox (inboxHub)
// hands over every inbox row the moment it becomes visible to its member, and this
// sends that member's own row to the devices they enabled. Disabled without VAPID keys.
//
// Each device gets its own PushDelivery: pending → accepted (the push service took it)
// → displayed → opened (acknowledged by the device's service worker, signed per
// delivery). Transient failures retry with bounded exponential backoff; a device the
// push service says is gone is forgotten; anything the service accepted is never sent
// again. Exactly-once display can't be promised: an attempt that times out may still
// have been delivered, so retries reuse the delivery's Topic (the push service replaces
// a waiting copy) and the notification tag (the phone replaces a shown one).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import webpush from 'web-push'
import { db, type InboxItem, type PushDelivery } from '@project/db'
import { badRequest, forbidden, notFound } from '../lib/errors'
import { toInboxItem, toUserInboxItem, type InboxItemView, type UserInboxItemView } from './inboxFanOut'

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } }
type Send = (target: PushTarget, payload: string, options: { topic: string }) => Promise<unknown>

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

/** How long a push service keeps an undelivered message (and we keep retrying). */
const TTL_S = 24 * 3600

function sender(): Send | null {
  if (override) return override
  const keys = vapid()
  if (!keys) return null
  return (target, payload, { topic }) => webpush.sendNotification(target, payload, { TTL: TTL_S, urgency: 'high', topic, vapidDetails: keys })
}

// The server POSTs to whatever endpoint a browser registered, so only the browsers'
// push services are accepted (Chrome/Edge/Opera, Apple, Mozilla, Windows).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/]

function checkTarget(input: PushTarget) {
  let url: URL
  try { url = new URL(input.endpoint) } catch { throw badRequest('Not a push endpoint', 'INVALID_PUSH_ENDPOINT') }
  if (url.protocol !== 'https:' || url.port || !PUSH_HOSTS.some((host) => host.test(url.hostname))) throw badRequest('Not a supported push service', 'INVALID_PUSH_ENDPOINT')
}

/** "Android · Chrome", "iPhone · Safari": enough to tell someone's devices apart. */
export function deviceLabel(userAgent: string | null) {
  if (!userAgent) return null
  const os = /iPhone/.test(userAgent) ? 'iPhone' : /iPad/.test(userAgent) ? 'iPad' : /Android/.test(userAgent) ? 'Android' : /Mac OS X|Macintosh/.test(userAgent) ? 'Mac' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : 'Other'
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /OPR\//.test(userAgent) ? 'Opera' : /SamsungBrowser/.test(userAgent) ? 'Samsung Internet' : /Firefox|FxiOS/.test(userAgent) ? 'Firefox' : /Chrome|CriOS/.test(userAgent) ? 'Chrome' : /Safari/.test(userAgent) ? 'Safari' : 'Browser'
  return `${os} · ${browser}`
}

// ─── outcome of one attempt ──────────────────────────────────────────────────

const statusOf = (err: unknown) => (err as { statusCode?: number }).statusCode

/** gone = the device's subscription no longer exists; transient = worth another try. */
export function classify(err: unknown): 'gone' | 'transient' | 'permanent' {
  const status = statusOf(err)
  if (status === 404 || status === 410) return 'gone'
  if (status === undefined || status === 408 || status === 429 || status >= 500) return 'transient'
  return 'permanent' // 400 bad request, 401/403 key mismatch, 413 too large: the same request won't succeed
}

const errorText = (err: unknown) => {
  const status = statusOf(err)
  const text = (err as { body?: string; message?: string }).body || (err as Error).message || ''
  return `${status ? `HTTP ${status}` : 'NETWORK'}: ${text.replace(/\s+/g, ' ')}`.slice(0, 200)
}

const MAX_ATTEMPTS = 6
const FIRST_RETRY_MS = 30_000
const MAX_RETRY_MS = 15 * 60_000
/** An attempt in progress holds the row this long, so two senders never send it together. */
const LEASE_MS = 2 * 60_000

/** 30 s, 1 min, 2 min, 4 min, 8 min (capped), or the push service's Retry-After. */
export function retryDelay(attempt: number, err?: unknown) {
  const header = (err as { headers?: Record<string, string> } | undefined)?.headers?.['retry-after']
  const asked = header ? (Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : NaN
  const backoff = Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, attempt - 1), MAX_RETRY_MS)
  return Number.isFinite(asked) && asked > 0 ? Math.min(Math.max(asked, backoff), MAX_RETRY_MS) : backoff
}

// ─── signed acknowledgments from the device ──────────────────────────────────

let ackKey: Buffer | null = null
function ackSigningKey() {
  if (ackKey) return ackKey
  const secret = process.env.SESSION_SECRET
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must be set')
  // Domain-separated from other signers; without a secret (dev/test), per process.
  ackKey = createHash('sha256').update('push-ack:').update(secret || randomBytes(32)).digest()
  return ackKey
}

/** Acknowledgments are accepted this long after a delivery was created. */
export const ACK_WINDOW_MS = 7 * 86_400_000

/** Proves an acknowledgment comes from the device that received this delivery. It names one
 *  delivery and only moves that delivery's state: it reads nothing and opens no other API. */
export const ackToken = (deliveryId: string) => createHmac('sha256', ackSigningKey()).update(deliveryId).digest('base64url').slice(0, 32)

/** Lets the push service replace a waiting copy if a retry follows an ambiguous attempt. */
const topicFor = (deliveryId: string) => createHash('sha256').update(deliveryId).digest('base64url').slice(0, 32)

export type AckEvent = 'displayed' | 'opened'

export async function acknowledge(deliveryId: string, token: string, event: AckEvent, now = new Date()) {
  const expected = Buffer.from(ackToken(deliveryId))
  const given = Buffer.from(token)
  // Unknown id and a wrong token look the same.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw notFound('Delivery not found')
  const row = await db.pushDelivery.findUnique({ where: { id: deliveryId } })
  // Expired tokens look like unknown ones too.
  if (!row || now.getTime() - row.createdAt.getTime() > ACK_WINDOW_MS) throw notFound('Delivery not found')
  // What the device saw is the truth: it was accepted and shown, whatever the server recorded.
  const opened = event === 'opened'
  const status = opened || row.status !== 'opened' ? event : row.status
  await db.pushDelivery.update({
    where: { id: deliveryId },
    data: {
      status,
      acceptedAt: row.acceptedAt ?? now,
      displayedAt: row.displayedAt ?? now,
      openedAt: opened ? row.openedAt ?? now : row.openedAt,
      endedAt: null,
      nextAttemptAt: null,
      lastError: row.status === 'failed' ? `${row.lastError ?? ''} (then shown on the device)`.slice(0, 200) : row.lastError,
    },
  })
}

// ─── policy and content ──────────────────────────────────────────────────────

// Push policy: a notification means something needs you. Everything else stays in the
// inbox only (room chatter, routine task changes, workspace activity, due tomorrow).
const PUSHED = new Set([
  'mention', // @you in a conversation
  'reply', // a reply to your message
  'task.assigned',
  'task.mention',
  'task.blocked',
  'task.overdue', // once, on its first overdue day, to the assignee (taskReminders.ts)
])
export const pushes = (type: string) => PUSHED.has(type)

/** What a room is called (a name is optional; the web shows its number instead). */
const roomName = (room: { title: string; number: number }) => room.title.trim() || `Project ${String(room.number).padStart(3, '0')}`

type Notification = { title: string; body: string; url: string }

/** A conversation notice: still in the room right now (access is the room's own). */
async function personal(item: UserInboxItemView): Promise<{ userId: string; notification: Notification } | null> {
  const member = await db.roomMember.findFirst({
    where: { roomId: item.sourceId, userId: item.userId, room: { deletedAt: null }, user: { isGuest: false } },
    select: { room: { select: { title: true, number: true } } },
  })
  if (!member) return null
  // "Sarah mentioned you · Website Redesign" / “Can you review the homepage…”
  return { userId: item.userId, notification: { title: `${item.title} · ${roomName(member.room)}`, body: item.summary, url: `/native/?open=${encodeURIComponent(item.id)}` } }
}

/** A workspace notice: still an active member right now (access may have been revoked). */
async function workspace(item: InboxItemView): Promise<{ userId: string; notification: Notification } | null> {
  const member = await db.workspaceMember.findFirst({
    where: { id: item.memberId, workspaceId: item.workspaceId, status: 'active', workspace: { deletedAt: null }, user: { isGuest: false } },
    select: { userId: true, workspace: { select: { name: true } } },
  })
  if (!member) return null
  return {
    userId: member.userId,
    notification: {
      title: item.title,
      body: item.summary && item.summary !== item.title ? `${member.workspace.name} · ${item.summary}` : member.workspace.name,
      url: `/native/?open=${encodeURIComponent(item.id)}&w=${encodeURIComponent(item.workspaceId)}`,
    },
  }
}

/** Who should get a row right now, and what it says. Built at send time: nothing is stored. */
const targetOf = (row: InboxItem) => (row.userId ? personal(toUserInboxItem(row)) : workspace(toInboxItem(row)))

// ─── deliveries ──────────────────────────────────────────────────────────────

/** Called for every inbox row when it becomes visible (inboxHub.releaseInbox). */
export async function pushInboxItem(item: InboxItemView | UserInboxItemView) {
  if (!item.unread || item.archivedAt || !pushes(item.type)) return
  if (!sender()) return
  // Claim once: a repeated release of the same row (idempotent raise, retries) never pushes again.
  const claimed = await db.inboxItem.updateMany({ where: { id: item.id, pushedAt: null, unread: true, archivedAt: null }, data: { pushedAt: new Date() } })
  if (!claimed.count) return
  const target = 'userId' in item ? await personal(item) : await workspace(item)
  if (!target) return
  const subs = await db.pushSubscription.findMany({ where: { userId: target.userId } })
  if (!subs.length) return
  const now = new Date()
  await db.pushDelivery.createMany({
    data: subs.map((sub) => ({
      inboxItemId: item.id,
      userId: target.userId,
      subscriptionId: sub.id,
      pushHost: new URL(sub.endpoint).hostname.slice(0, 100),
      device: deviceLabel(sub.userAgent),
      kind: item.type,
      status: 'pending',
      nextAttemptAt: now,
    })),
    skipDuplicates: true,
  })
  const created = await db.pushDelivery.findMany({ where: { inboxItemId: item.id, status: 'pending' }, select: { id: true } })
  await Promise.all(created.map((d) => attemptDelivery(d.id, now)))
}

const end = (id: string, status: 'failed' | 'cancelled', lastError: string, lastStatusCode?: number) =>
  db.pushDelivery.updateMany({ where: { id, status: 'pending' }, data: { status, lastError, lastStatusCode: lastStatusCode ?? null, nextAttemptAt: null, endedAt: new Date() } })

/** One attempt at one delivery, if it is due. Safe to call from several places at once. */
export async function attemptDelivery(id: string, now = new Date()) {
  const send = sender()
  if (!send) return
  const d = await db.pushDelivery.findUnique({ where: { id }, include: { inboxItem: true, subscription: true } })
  if (!d || d.status !== 'pending' || (d.nextAttemptAt && d.nextAttemptAt > now)) return
  // Lease it: only the caller that moves `attempts` on sends.
  const claimed = await db.pushDelivery.updateMany({
    where: { id, status: 'pending', attempts: d.attempts },
    data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  })
  if (!claimed.count) return
  const attempt = d.attempts + 1

  if (!d.subscription) return void (await end(id, 'failed', 'DEVICE_REMOVED'))
  if (now.getTime() - d.createdAt.getTime() > TTL_S * 1000) return void (await end(id, 'failed', 'EXPIRED'))
  // Seen elsewhere since (read on the desktop, archived): don't buzz the phone late.
  if (!d.inboxItem.unread || d.inboxItem.archivedAt) return void (await end(id, 'cancelled', 'READ_ELSEWHERE'))
  const target = await targetOf(d.inboxItem)
  if (!target || target.userId !== d.userId || d.subscription.userId !== d.userId) return void (await end(id, 'cancelled', 'ACCESS_CHANGED'))

  const payload = JSON.stringify({ ...target.notification, tag: `inbox:${d.inboxItemId}`, delivery: { id, token: ackToken(id) } })
  try {
    const res = await send({ endpoint: d.subscription.endpoint, keys: { p256dh: d.subscription.p256dh, auth: d.subscription.auth } }, payload, { topic: topicFor(id) })
    const code = (res as { statusCode?: number } | undefined)?.statusCode ?? 201
    // An acknowledgment may already have moved it on; never move it back.
    await db.pushDelivery.updateMany({ where: { id, status: 'pending' }, data: { status: 'accepted', acceptedAt: now, nextAttemptAt: null, lastStatusCode: code, lastError: null } })
    await db.pushDelivery.updateMany({ where: { id, acceptedAt: null }, data: { acceptedAt: now } })
    await db.pushSubscription.updateMany({ where: { id: d.subscription.id }, data: { lastSuccessAt: now } })
  } catch (err) {
    const outcome = classify(err)
    const message = errorText(err)
    const status = statusOf(err)
    console.warn(`[push] delivery ${id} attempt ${attempt} ${outcome}: ${message}`)
    if (outcome === 'gone') {
      // The browser dropped this subscription: forget the device (its deliveries keep the label).
      await end(id, 'failed', message, status)
      await db.pushSubscription.deleteMany({ where: { id: d.subscription.id } })
    } else if (outcome === 'transient' && attempt < MAX_ATTEMPTS) {
      await db.pushDelivery.updateMany({
        where: { id, status: 'pending' },
        data: { nextAttemptAt: new Date(now.getTime() + retryDelay(attempt, err)), lastError: message, lastStatusCode: status ?? null },
      })
    } else {
      await end(id, 'failed', outcome === 'transient' ? `GAVE_UP after ${attempt}: ${message}`.slice(0, 200) : message, status)
    }
  }
}

/** Due retries (and leases left behind by a crash). */
export async function sweepPushDeliveries(now = new Date()) {
  const due = await db.pushDelivery.findMany({ where: { status: 'pending', nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: 'asc' }, take: 50, select: { id: true } })
  for (const d of due) await attemptDelivery(d.id, now)
  return due.length
}

let timer: NodeJS.Timeout | null = null
export function startPushSweep(intervalMs = 15_000) {
  if (process.env.AGENTS_SCHEDULER === 'off' || timer || !sender()) return false
  let busy = false
  timer = setInterval(() => {
    if (busy) return
    busy = true
    sweepPushDeliveries()
      .catch((err) => console.error('[push] sweep failed', err))
      .finally(() => { busy = false })
  }, intervalMs)
  timer.unref()
  return true
}

export function stopPushSweep() {
  if (timer) clearInterval(timer)
  timer = null
}

// ─── registration, test, diagnostics ─────────────────────────────────────────

export class PushService {
  async subscribe(user: { id: string; isGuest: boolean }, input: PushTarget & { userAgent?: string }) {
    if (user.isGuest) throw forbidden('Sign in to turn on notifications')
    checkTarget(input)
    // The same device signed in as someone else now belongs to them.
    const data = { userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent?.slice(0, 200) ?? null }
    const row = await db.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data })
    return { endpoint: row.endpoint, createdAt: row.createdAt.toISOString() }
  }

  /** How many devices get this person's notifications (the desktop app's "Get the app"). */
  async devices(userId: string) {
    return db.pushSubscription.count({ where: { userId } })
  }

  async unsubscribe(userId: string, endpoint: string) {
    await db.pushSubscription.deleteMany({ where: { userId, endpoint } })
  }

  /** A visible check from Settings that this device really receives pushes (no delivery record). */
  async test(userId: string) {
    const send = sender()
    if (!send) throw badRequest('Push notifications are not configured on this server', 'PUSH_DISABLED')
    const subs = await db.pushSubscription.findMany({ where: { userId } })
    const payload = JSON.stringify({ title: 'Notifications are on', body: 'You’ll hear from your workspaces here.', tag: 'push-test', url: '/native/settings' })
    let sent = 0
    let removed = 0
    await Promise.all(subs.map(async (sub) => {
      try {
        await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { topic: 'push-test' })
        sent++
        await db.pushSubscription.updateMany({ where: { id: sub.id }, data: { lastSuccessAt: new Date() } })
      } catch (err) {
        if (classify(err) === 'gone') {
          removed++
          await db.pushSubscription.deleteMany({ where: { id: sub.id } })
        } else {
          console.warn('[push] test failed', errorText(err))
        }
      }
    }))
    return { sent, removed }
  }
}

const STATUSES = ['pending', 'accepted', 'displayed', 'opened', 'failed', 'cancelled'] as const

/** Staff diagnostics: how far deliveries get, by stage, and what went wrong. No message content. */
export async function deliveryDiagnostics(query: { days?: number; status?: string; userId?: string; limit?: number }) {
  const days = Math.min(Math.max(Number(query.days ?? 7), 1), 90)
  const since = new Date(Date.now() - days * 86_400_000)
  const where = { createdAt: { gte: since } }
  const [byStatus, reached, failures, recent, devices] = await Promise.all([
    db.pushDelivery.groupBy({ by: ['status'], where, _count: { _all: true } }),
    // Each stage counts every delivery that got at least that far.
    Promise.all([
      db.pushDelivery.count({ where: { ...where, acceptedAt: { not: null } } }),
      db.pushDelivery.count({ where: { ...where, displayedAt: { not: null } } }),
      db.pushDelivery.count({ where: { ...where, openedAt: { not: null } } }),
    ]),
    db.pushDelivery.groupBy({ by: ['lastStatusCode', 'pushHost'], where: { ...where, status: 'failed' }, _count: { _all: true }, orderBy: { _count: { id: 'desc' } }, take: 20 }),
    db.pushDelivery.findMany({
      where: { ...where, ...(query.status && (STATUSES as readonly string[]).includes(query.status) ? { status: query.status } : {}), ...(query.userId ? { userId: query.userId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(query.limit ?? 50), 1), 200),
      include: { user: { select: { id: true, email: true, profile: { select: { displayName: true } } } } },
    }),
    db.pushSubscription.count(),
  ])
  const count = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0
  const total = byStatus.reduce((n, s) => n + s._count._all, 0)
  return {
    since: since.toISOString(),
    devices,
    total,
    stages: { accepted: reached[0], displayed: reached[1], opened: reached[2] },
    // Accepted by the push service, no word from the device yet: unconfirmed, not undelivered.
    unconfirmed: count('accepted'),
    now: Object.fromEntries(STATUSES.map((s) => [s, count(s)])) as Record<(typeof STATUSES)[number], number>,
    failures: failures.map((f) => ({ statusCode: f.lastStatusCode, pushHost: f.pushHost, count: f._count._all })),
    recent: recent.map((d: PushDelivery & { user: { id: string; email: string | null; profile: { displayName: string } | null } }) => ({
      id: d.id,
      kind: d.kind,
      status: d.status,
      attempts: d.attempts,
      device: d.device,
      pushHost: d.pushHost,
      lastStatusCode: d.lastStatusCode,
      lastError: d.lastError,
      user: { id: d.user.id, displayName: d.user.profile?.displayName ?? '', email: d.user.email },
      createdAt: d.createdAt.toISOString(),
      acceptedAt: d.acceptedAt?.toISOString() ?? null,
      displayedAt: d.displayedAt?.toISOString() ?? null,
      openedAt: d.openedAt?.toISOString() ?? null,
      endedAt: d.endedAt?.toISOString() ?? null,
      nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
    })),
  }
}
