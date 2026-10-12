// Push deliveries: one per device, pending → accepted → displayed → opened. Transient
// failures retry with bounded backoff; gone devices are forgotten; accepted is final for
// sending; device acknowledgments are signed; staff see states, never content.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, daveId, join, seedPeople } from './helpers/workspace'
import { ackToken, attemptDelivery, deviceLabel, retryDelay, setPushSender, sweepPushDeliveries, type PushTarget } from '../services/push'

const app = buildTestApp()
const call = caller(app)

type Sent = { endpoint: string; topic: string; payload: { title: string; delivery: { id: string; token: string } } }
let sent: Sent[] = []
/** What the push service answers next, per endpoint (an error status, or accept). */
let answer: (target: PushTarget) => { statusCode?: number; headers?: Record<string, string> } | 'ok' = () => 'ok'

beforeEach(() => {
  sent = []
  answer = () => 'ok'
  setPushSender(async (target, payload, { topic }) => {
    const a = answer(target)
    if (a !== 'ok') throw Object.assign(new Error('push service error'), { ...a, body: 'nope' })
    sent.push({ endpoint: target.endpoint, topic, payload: JSON.parse(payload) })
    return { statusCode: 201 }
  })
})
afterEach(() => setPushSender(null))

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const phone = { endpoint: 'https://fcm.googleapis.com/fcm/send/carol-phone', keys: { p256dh: 'k1', auth: 'a1' }, userAgent: ANDROID }
const ipad = { endpoint: 'https://web.push.apple.com/carol-iphone', keys: { p256dh: 'k2', auth: 'a2' }, userAgent: IPHONE }

/** Alice assigns Carol a task: one pushed notice, delivered to each of Carol's devices. */
async function assignCarol(devices = [phone, ipad]) {
  const ws = await createWorkspace(app)
  await seedPeople()
  const carol = await join(app, ws.id, carolId, 'carol@test.local')
  for (const d of devices) await call(carolId, 'POST', '/push/subscriptions', d)
  const task = (await call(testUserId, 'POST', `/workspaces/${ws.id}/tasks`, { title: 'Fix the login', assigneeMemberId: carol })).json().data
  const row = await db.inboxItem.findFirstOrThrow({ where: { memberId: carol, sourceId: task.id } })
  // Every device has had its first attempt (whatever the push service answered).
  await vi.waitFor(async () => expect(await db.pushDelivery.count({ where: { inboxItemId: row.id, attempts: { gte: 1 }, OR: [{ status: { not: 'pending' } }, { lastError: { not: null } }] } })).toBe(devices.length))
  return { ws, row, task }
}

const deliveries = (inboxItemId: string) => db.pushDelivery.findMany({ where: { inboxItemId }, orderBy: { device: 'asc' } })

describe('push deliveries', () => {
  it('one delivery per device, accepted with a signed acknowledgment, and no message content kept', async () => {
    const { row, task } = await assignCarol()
    const rows = await deliveries(row.id)
    expect(rows.map((d) => [d.device, d.pushHost, d.kind, d.status, d.attempts])).toEqual([
      ['Android · Chrome', 'fcm.googleapis.com', 'task.assigned', 'accepted', 1],
      ['iPhone · Safari', 'web.push.apple.com', 'task.assigned', 'accepted', 1],
    ])
    expect(rows.every((d) => d.acceptedAt && d.lastStatusCode === 201 && !d.nextAttemptAt)).toBe(true)
    expect(sent).toHaveLength(2)
    for (const s of sent) {
      const d = rows.find((r) => r.id === s.payload.delivery.id)!
      expect(s.payload.delivery.token).toBe(ackToken(d.id))
      expect(s.topic).toMatch(/^[A-Za-z0-9_-]{32}$/)
    }
    // Only states and device identity: the task's words are nowhere in the delivery rows.
    expect(JSON.stringify(rows)).not.toContain(task.title)
    expect(JSON.stringify(rows)).not.toContain(task.taskKey)
  })

  it('retries a transient failure with backoff on the same topic, then succeeds; accepted is never sent again', async () => {
    let fail = true
    answer = (t) => (fail && t.endpoint === phone.endpoint ? { statusCode: 503 } : 'ok')
    const { row } = await assignCarol()
    let [android] = await deliveries(row.id)
    expect(android).toMatchObject({ status: 'pending', attempts: 1, lastStatusCode: 503 })
    expect(android!.lastError).toContain('HTTP 503')
    const wait = android!.nextAttemptAt!.getTime() - Date.now()
    expect(wait).toBeGreaterThan(20_000)
    expect(wait).toBeLessThanOrEqual(30_000)

    // Not due yet: nothing happens.
    expect(await sweepPushDeliveries(new Date())).toBe(0)
    fail = false
    await sweepPushDeliveries(new Date(Date.now() + 31_000))
    ;[android] = await deliveries(row.id)
    expect(android).toMatchObject({ status: 'accepted', attempts: 2, lastError: null })
    const toPhone = sent.filter((s) => s.endpoint === phone.endpoint)
    expect(toPhone).toHaveLength(1)

    // Accepted is final for sending: later sweeps and direct attempts send nothing.
    await sweepPushDeliveries(new Date(Date.now() + 3_600_000))
    await attemptDelivery(android!.id, new Date(Date.now() + 3_600_000))
    expect(sent.filter((s) => s.endpoint === phone.endpoint)).toHaveLength(1)
  })

  it('backs off exponentially within a bound, honours Retry-After, and gives up after the last attempt', async () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => retryDelay(n) / 1000)).toEqual([30, 60, 120, 240, 480, 900, 900])
    expect(retryDelay(1, { headers: { 'retry-after': '120' } })).toBe(120_000)
    expect(retryDelay(1, { headers: { 'retry-after': '99999' } })).toBe(900_000)

    answer = () => ({ statusCode: 500 })
    const { row } = await assignCarol([phone])
    let at = Date.now()
    for (let i = 0; i < 8; i++) {
      at += 16 * 60_000
      await sweepPushDeliveries(new Date(at))
    }
    const [d] = await deliveries(row.id)
    expect(d).toMatchObject({ status: 'failed', attempts: 6 })
    expect(d!.lastError).toMatch(/^GAVE_UP after 6: HTTP 500/)
    expect(d!.endedAt).not.toBeNull()
    // The device is kept: the service was failing, not the subscription.
    expect(await db.pushSubscription.count({ where: { userId: carolId } })).toBe(1)
  })

  it('forgets a device the push service says is gone, and fails a rejected request without retrying', async () => {
    answer = (t) => (t.endpoint === phone.endpoint ? { statusCode: 410 } : { statusCode: 403 })
    const { row } = await assignCarol()
    const [android, iphone] = await deliveries(row.id)
    expect(android).toMatchObject({ status: 'failed', subscriptionId: null, device: 'Android · Chrome', lastStatusCode: 410 })
    expect(iphone).toMatchObject({ status: 'failed', lastStatusCode: 403, attempts: 1 })
    expect((await db.pushSubscription.findMany({ where: { userId: carolId } })).map((s) => s.endpoint)).toEqual([ipad.endpoint])
    await sweepPushDeliveries(new Date(Date.now() + 3_600_000))
    expect((await deliveries(row.id)).map((d) => d.attempts)).toEqual([1, 1])
  })

  it('a retry that comes after the notice was read elsewhere is cancelled, not sent', async () => {
    answer = () => ({ statusCode: 429, headers: { 'retry-after': '60' } })
    const { row } = await assignCarol([phone])
    await db.inboxItem.update({ where: { id: row.id }, data: { unread: false } })
    answer = () => 'ok'
    await sweepPushDeliveries(new Date(Date.now() + 61_000))
    const [d] = await deliveries(row.id)
    expect(d).toMatchObject({ status: 'cancelled', lastError: 'READ_ELSEWHERE' })
    expect(sent).toHaveLength(0)
  })

  it('two senders racing on one due delivery send it once', async () => {
    answer = () => ({ statusCode: 502 })
    const { row } = await assignCarol([phone])
    answer = () => 'ok'
    const [d] = await deliveries(row.id)
    const later = new Date(Date.now() + 60_000)
    await Promise.all([attemptDelivery(d!.id, later), attemptDelivery(d!.id, later), sweepPushDeliveries(later)])
    expect(sent).toHaveLength(1)
    expect((await deliveries(row.id))[0]).toMatchObject({ status: 'accepted', attempts: 2 })
  })

  it('records displayed and opened only with the delivery’s own token; device evidence wins', async () => {
    const { row } = await assignCarol([phone])
    const [d] = await deliveries(row.id)
    const ack = (id: string, token: string, event: string) => app.inject({ method: 'POST', url: `/push/deliveries/${id}/ack`, payload: { token, event } })

    expect((await ack(d!.id, 'x'.repeat(32), 'displayed')).statusCode).toBe(404)
    expect((await ack('not-a-delivery', ackToken('not-a-delivery'), 'displayed')).statusCode).toBe(404)
    expect((await ack(d!.id, ackToken(d!.id), 'seen')).statusCode).toBe(400)

    expect((await ack(d!.id, ackToken(d!.id), 'displayed')).statusCode).toBe(204)
    let now = (await deliveries(row.id))[0]!
    expect(now.status).toBe('displayed')
    expect(now.displayedAt).not.toBeNull()
    expect((await ack(d!.id, ackToken(d!.id), 'opened')).statusCode).toBe(204)
    // A late "displayed" doesn't undo "opened".
    expect((await ack(d!.id, ackToken(d!.id), 'displayed')).statusCode).toBe(204)
    now = (await deliveries(row.id))[0]!
    expect(now.status).toBe('opened')
    expect(now.openedAt!.getTime()).toBeGreaterThanOrEqual(now.displayedAt!.getTime())

    // Gave up on the server side, but the phone showed it after all: the phone is right.
    await db.pushDelivery.update({ where: { id: d!.id }, data: { status: 'failed', displayedAt: null, openedAt: null, lastError: 'GAVE_UP after 6: NETWORK: timeout' } })
    await ack(d!.id, ackToken(d!.id), 'displayed')
    now = (await deliveries(row.id))[0]!
    expect(now.status).toBe('displayed')
    expect(now.lastError).toContain('then shown on the device')
  })

  it('staff see delivery stages, failures and devices; nobody else does', async () => {
    answer = (t) => (t.endpoint === ipad.endpoint ? { statusCode: 410 } : 'ok')
    const { row, task } = await assignCarol()
    const [android] = await deliveries(row.id)
    await app.inject({ method: 'POST', url: `/push/deliveries/${android!.id}/ack`, payload: { token: ackToken(android!.id), event: 'opened' } })

    expect((await call(carolId, 'GET', '/admin/push/deliveries')).statusCode).toBe(403)
    await db.platformStaff.create({ data: { userId: daveId, role: 'platform_admin', grantedById: 'test' } })
    const res = await call(daveId, 'GET', '/admin/push/deliveries?days=1')
    expect(res.statusCode).toBe(200)
    await validateResponse('getPushDiagnostics', 200, res.json())
    const data = res.json().data
    expect(data).toMatchObject({ total: 2, devices: 1, stages: { accepted: 1, displayed: 1, opened: 1 }, now: { opened: 1, failed: 1, pending: 0 } })
    expect(data.failures).toEqual([{ statusCode: 410, pushHost: 'web.push.apple.com', count: 1 }])
    expect(data.recent.map((r: { device: string; status: string }) => `${r.device}:${r.status}`).sort()).toEqual(['Android · Chrome:opened', 'iPhone · Safari:failed'])
    expect(JSON.stringify(data)).not.toContain(task.title)
    const failed = await call(daveId, 'GET', '/admin/push/deliveries?status=failed')
    expect(failed.json().data.recent).toHaveLength(1)
  })

  it('labels devices from their user agent', () => {
    expect([ANDROID, IPHONE, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0', null].map(deviceLabel))
      .toEqual(['Android · Chrome', 'iPhone · Safari', 'Mac · Safari', 'Windows · Edge', null])
  })
})
