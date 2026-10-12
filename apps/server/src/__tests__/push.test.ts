// Web Push for the /native/ app: devices register per user; every inbox row that
// becomes visible is pushed once to its member's devices, from the existing flow.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testOtherUserId, testUserId, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, daveId, join, seedPeople } from './helpers/workspace'
import { releaseInbox } from '../services/inboxHub'
import { toInboxItem } from '../services/inboxFanOut'
import { setPushSender, type PushTarget } from '../services/push'

const app = buildTestApp()
const call = caller(app)

const device = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` } })

type Sent = { endpoint: string; payload: { title: string; body: string; tag: string; url: string } }
function capture(fail?: (target: PushTarget) => number | undefined) {
  const sent: Sent[] = []
  setPushSender(async (target, payload) => {
    const status = fail?.(target)
    if (status) throw Object.assign(new Error('push failed'), { statusCode: status })
    sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) })
  })
  return sent
}

// Push is off unless a test turns it on (a developer's .env may hold real keys).
beforeEach(() => {
  vi.stubEnv('VAPID_PUBLIC_KEY', '')
  vi.stubEnv('VAPID_PRIVATE_KEY', '')
})

afterEach(() => {
  setPushSender(null)
  vi.unstubAllEnvs()
})

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  const carol = await join(app, ws.id, carolId, 'carol@test.local')
  return { ws, carol, tasks: `/workspaces/${ws.id}/tasks` }
}

describe('push registration', () => {
  it('reports the public key only when VAPID is configured', async () => {
    let res = await call(testUserId, 'GET', '/push/config')
    await validateResponse('getPushConfig', 200, res.json())
    expect(res.json().data.publicKey).toBeNull()
    vi.stubEnv('VAPID_PUBLIC_KEY', 'BPublicKey')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'private')
    res = await call(testUserId, 'GET', '/push/config')
    expect(res.json().data.publicKey).toBe('BPublicKey')
  })

  it('registers devices for signed-in people only, on known push services, and moves a device between accounts', async () => {
    await seedPeople()
    expect((await call(testOtherUserId, 'POST', '/push/subscriptions', device(1))).statusCode).toBe(403)
    for (const endpoint of ['https://evil.example.com/push', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://127.0.0.1/x', 'not a url']) {
      const res = await call(testUserId, 'POST', '/push/subscriptions', { ...device(1), endpoint })
      expect(res.statusCode, endpoint).toBe(400)
      expect(res.json().code).toBe('INVALID_PUSH_ENDPOINT')
    }
    const ok = await call(testUserId, 'POST', '/push/subscriptions', device(1))
    expect(ok.statusCode).toBe(201)
    await validateResponse('subscribePush', 201, ok.json())
    // Idempotent; a second device is a second row.
    await call(testUserId, 'POST', '/push/subscriptions', device(1))
    await call(testUserId, 'POST', '/push/subscriptions', { ...device(2), endpoint: 'https://web.push.apple.com/abc' })
    expect(await db.pushSubscription.count({ where: { userId: testUserId } })).toBe(2)
    // Carol signs in on Alice's first device: it is Carol's now.
    await call(carolId, 'POST', '/push/subscriptions', device(1))
    expect((await db.pushSubscription.findUniqueOrThrow({ where: { endpoint: device(1).endpoint } })).userId).toBe(carolId)
    // Removing only touches your own device.
    expect((await call(testUserId, 'DELETE', `/push/subscriptions?endpoint=${encodeURIComponent(device(1).endpoint)}`)).statusCode).toBe(204)
    expect(await db.pushSubscription.count({ where: { endpoint: device(1).endpoint } })).toBe(1)
    await call(carolId, 'DELETE', `/push/subscriptions?endpoint=${encodeURIComponent(device(1).endpoint)}`)
    expect(await db.pushSubscription.count({ where: { endpoint: device(1).endpoint } })).toBe(0)
  })
})

describe('push delivery', () => {
  it('pushes each new inbox row once to every device of its recipient, never to the actor', async () => {
    const { ws, carol, tasks } = await setup()
    const sent = capture()
    await call(carolId, 'POST', '/push/subscriptions', device(1))
    await call(carolId, 'POST', '/push/subscriptions', device(2))
    await call(testUserId, 'POST', '/push/subscriptions', device(3))

    const task = (await call(testUserId, 'POST', tasks, { title: 'Fix the login', assigneeMemberId: carol })).json().data
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    const row = await db.inboxItem.findFirstOrThrow({ where: { memberId: carol, sourceId: task.id } })
    expect(row.pushedAt).not.toBeNull()
    expect(sent.map((s) => s.endpoint).sort()).toEqual([device(1).endpoint, device(2).endpoint])
    expect(sent[0]!.payload).toEqual({
      title: `Alice assigned you ${task.taskKey}`,
      body: 'Acme Co · Fix the login',
      tag: `inbox:${row.id}`,
      url: `/native/?open=${row.id}&w=${ws.id}`,
    })

    // A repeated release of the same row (idempotent raise, retry) pushes nothing more.
    releaseInbox(toInboxItem(row))
    await new Promise((r) => setTimeout(r, 150))
    expect(sent).toHaveLength(2)

    // A mention reaches Carol; Alice (the actor) never hears about her own comment.
    await call(testUserId, 'POST', `${tasks}/${task.id}/comments`, { text: '@Carol can you check?' })
    await vi.waitFor(() => expect(sent).toHaveLength(4))
    expect(sent.every((s) => s.endpoint !== device(3).endpoint)).toBe(true)
    expect(sent[3]!.payload.title).toBe(`Alice mentioned you on ${task.taskKey}`)
  })

  it('forgets devices the push service reports gone and keeps the rest', async () => {
    const { carol, tasks } = await setup()
    const sent = capture((target) => (target.endpoint === device(1).endpoint ? 410 : undefined))
    await call(carolId, 'POST', '/push/subscriptions', device(1))
    await call(carolId, 'POST', '/push/subscriptions', device(2))
    await call(testUserId, 'POST', tasks, { title: 'One', assigneeMemberId: carol })
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    await vi.waitFor(async () => expect(await db.pushSubscription.count({ where: { userId: carolId } })).toBe(1))
    expect((await db.pushSubscription.findFirstOrThrow({ where: { userId: carolId } })).lastSuccessAt).not.toBeNull()
  })

  it('sends nothing to someone whose access was revoked, or for rows already read', async () => {
    const { carol, tasks } = await setup()
    const sent = capture()
    await call(carolId, 'POST', '/push/subscriptions', device(1))
    const task = (await call(testUserId, 'POST', tasks, { title: 'Two', assigneeMemberId: carol })).json().data
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    const row = await db.inboxItem.findFirstOrThrow({ where: { memberId: carol, sourceId: task.id } })

    // Removed between the row being written and released.
    const pending = await db.inboxItem.update({ where: { id: row.id }, data: { pushedAt: null } })
    await db.workspaceMember.update({ where: { id: carol }, data: { status: 'removed', removedAt: new Date() } })
    releaseInbox(toInboxItem(pending))
    await new Promise((r) => setTimeout(r, 150))
    expect(sent).toHaveLength(1)

    // Read already (e.g. on the desktop): nothing to tell.
    await db.workspaceMember.update({ where: { id: carol }, data: { status: 'active', removedAt: null } })
    const read = await db.inboxItem.update({ where: { id: row.id }, data: { pushedAt: null, unread: false } })
    releaseInbox(toInboxItem(read))
    await new Promise((r) => setTimeout(r, 150))
    expect(sent).toHaveLength(1)
  })

  it('pushes a conversation message once per person, not once per shared workspace', async () => {
    await seedPeople()
    const sent = capture()
    const a = await createWorkspace(app, testUserId, { name: 'One' })
    const b = await createWorkspace(app, testUserId, { name: 'Two' })
    await join(app, a.id, daveId, 'dave@test.local')
    await join(app, b.id, daveId, 'dave@test.local')
    await call(daveId, 'POST', '/push/subscriptions', device(9))
    const room = (await call(testUserId, 'POST', '/rooms', { title: 'Standup' })).json().data
    await call(daveId, 'POST', `/rooms/${room.id}/join`)
    const posted = await call(testUserId, 'POST', `/rooms/${room.id}/items`, { text: 'Morning all' })
    expect(posted.statusCode).toBe(201)
    await vi.waitFor(async () => expect(await db.inboxItem.count({ where: { sourceId: room.id, pushedAt: { not: null }, member: { userId: daveId } } })).toBe(2))
    await new Promise((r) => setTimeout(r, 100))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.payload.tag).toBe(`room:${room.id}`)
  })

  it('test push reaches the caller’s devices, and says so when push is off', async () => {
    await seedPeople()
    const off = await call(carolId, 'POST', '/push/test')
    expect(off.statusCode).toBe(400)
    expect(off.json().code).toBe('PUSH_DISABLED')
    const sent = capture()
    await call(carolId, 'POST', '/push/subscriptions', device(1))
    const res = await call(carolId, 'POST', '/push/test')
    await validateResponse('testPush', 200, res.json())
    expect(res.json().data).toEqual({ sent: 1, removed: 0 })
    expect(sent[0]!.payload.url).toBe('/native/settings')
  })
})
