// Conversation notices are the person's own (rooms have no workspace): an @mention or a
// reply to your message is addressed to you and pushed; other messages are inbox-only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, seedImage, testOtherUserId, testUserId, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, daveId, join, seedPeople } from './helpers/workspace'
import { setPushSender } from '../services/push'

const app = buildTestApp()
const call = caller(app)

type Sent = { endpoint: string; payload: { title: string; body: string; tag: string; url: string } }
let sent: Sent[] = []

beforeEach(() => {
  sent = []
  setPushSender(async (target, payload) => { sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) }) })
})
afterEach(() => setPushSender(null))

const device = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/c-${n}`, keys: { p256dh: `k-${n}`, auth: `a-${n}` } })

/** Alice's room "Website Redesign" with Carol and Dave in it; Carol and Dave have phones. */
async function setup() {
  await seedPeople()
  const room = (await call(testUserId, 'POST', '/rooms', { title: 'Website Redesign' })).json().data as { id: string }
  for (const id of [carolId, daveId]) {
    expect((await call(id, 'POST', `/rooms/${room.id}/join`)).statusCode).toBe(200)
  }
  await call(carolId, 'POST', '/push/subscriptions', device(1))
  await call(daveId, 'POST', '/push/subscriptions', device(2))
  return room
}

const post = async (userId: string, roomId: string, body: object) => {
  const res = await call(userId, 'POST', `/rooms/${roomId}/items`, body)
  expect(res.statusCode, res.body).toBe(201)
  return res.json().data as { id: string }
}

const rowsFor = (itemId: string) => db.inboxItem.findMany({ where: { dedupeKey: itemId }, orderBy: { userId: 'asc' } })

async function settled(itemId: string, count: number) {
  await vi.waitFor(async () => expect(await db.inboxItem.count({ where: { dedupeKey: itemId } })).toBe(count))
  await new Promise((r) => setTimeout(r, 120))
}

describe('conversation notices', () => {
  it('an @mention is pushed to that person only; everyone else in the room gets an inbox-only row', async () => {
    const room = await setup()
    const item = await post(testUserId, room.id, { text: '@Carol can you review the homepage before tomorrow?' })
    await settled(item.id, 2)
    const rows = await rowsFor(item.id)
    expect(rows.map((r) => [r.userId, r.type, r.title])).toEqual([
      [carolId, 'mention', 'Alice mentioned you'],
      [daveId, 'message', 'Alice'],
    ])
    // The person's own rows: no workspace, linked to the room.
    expect(rows.every((r) => r.workspaceId === null && r.memberId === null && r.sourceType === 'conversation' && r.sourceId === room.id)).toBe(true)
    expect(sent).toEqual([{
      endpoint: device(1).endpoint,
      payload: {
        title: 'Alice mentioned you · Website Redesign',
        body: '“@Carol can you review the homepage before tomorrow?”',
        tag: `inbox:${rows[0]!.id}`,
        url: `/native/?open=${rows[0]!.id}`,
      },
    }])
  })

  it('a reply tells the parent’s author; mentioned and replied-to gives one notice, not two', async () => {
    const room = await setup()
    const carols = await post(carolId, room.id, { text: 'First draft is up' })
    await settled(carols.id, 2)
    sent = []
    const reply = await call(testUserId, 'POST', `/items/${carols.id}/replies`, { text: 'Looks good' })
    expect(reply.statusCode).toBe(201)
    await settled(reply.json().data.id, 2)
    expect((await rowsFor(reply.json().data.id)).map((r) => [r.userId, r.type, r.title])).toEqual([
      [carolId, 'reply', 'Alice replied to you'],
      [daveId, 'message', 'Alice'],
    ])
    expect(sent.map((s) => s.payload.title)).toEqual(['Alice replied to you · Website Redesign'])

    sent = []
    const both = await call(testUserId, 'POST', `/items/${carols.id}/replies`, { text: '@Carol and one more thing' })
    await settled(both.json().data.id, 2)
    const carolRows = (await rowsFor(both.json().data.id)).filter((r) => r.userId === carolId)
    expect(carolRows.map((r) => r.type)).toEqual(['mention'])
    expect(sent).toHaveLength(1)
  })

  it('nobody hears from someone they muted, the author never hears themselves, guests get nothing', async () => {
    const room = await setup()
    expect((await call(testOtherUserId, 'POST', `/rooms/${room.id}/join`)).statusCode).toBe(200) // Bob, a guest
    expect((await call(daveId, 'PUT', `/users/me/mutes/${testUserId}`)).statusCode).toBe(200)
    const item = await post(testUserId, room.id, { text: '@Dave @Carol ping' })
    await settled(item.id, 1)
    expect((await rowsFor(item.id)).map((r) => r.userId)).toEqual([carolId])
    expect(sent.map((s) => s.endpoint)).toEqual([device(1).endpoint])
  })

  it('previews a message without text by what it carries', async () => {
    const room = await setup()
    const image = await seedImage(testUserId)
    const item = await post(testUserId, room.id, { mediaIds: [image.id] })
    await settled(item.id, 2)
    expect(new Set((await rowsFor(item.id)).map((r) => r.summary))).toEqual(new Set(['Sent a photo']))
  })

  it('writes one row per person even when they share several workspaces with the author', async () => {
    const room = await setup()
    for (const name of ['One', 'Two']) {
      const ws = await createWorkspace(app, testUserId, { name })
      await join(app, ws.id, carolId, 'carol@test.local')
    }
    const item = await post(testUserId, room.id, { text: 'Hello' })
    await settled(item.id, 2)
    expect(await db.inboxItem.count({ where: { dedupeKey: item.id, userId: carolId } })).toBe(1)
    expect(await db.inboxItem.count({ where: { dedupeKey: item.id, workspaceId: { not: null } } })).toBe(0)
  })

  it('lists the person’s notices with the room name, reads them, and hides rooms they left', async () => {
    const room = await setup()
    const item = await post(testUserId, room.id, { text: '@Carol hi' })
    await settled(item.id, 2)
    const list = await call(carolId, 'GET', '/me/inbox')
    await validateResponse('listMyInboxItems', 200, list.json())
    const [notice] = list.json().data
    expect(notice).toMatchObject({ type: 'mention', title: 'Alice mentioned you', summary: '“@Carol hi”', sourceId: room.id, sourceTitle: 'Website Redesign', unread: true })
    expect((await call(carolId, 'GET', '/me/inbox?unread=true')).json().data).toHaveLength(1)

    const read = await call(carolId, 'PATCH', `/me/inbox/${notice.id}/read`, { unread: false })
    await validateResponse('readMyInboxItem', 200, read.json())
    expect(read.json().data.unread).toBe(false)
    expect((await call(carolId, 'GET', '/me/inbox?unread=true')).json().data).toHaveLength(0)
    // Someone else's notice is not yours to read.
    expect((await call(daveId, 'PATCH', `/me/inbox/${notice.id}/read`, { unread: true })).statusCode).toBe(404)

    // Left the room: its notices are gone from the list and can't be touched.
    expect((await call(carolId, 'DELETE', `/rooms/${room.id}/members/me`)).statusCode).toBeLessThan(300)
    expect((await call(carolId, 'GET', '/me/inbox')).json().data).toEqual([])
    expect((await call(carolId, 'PATCH', `/me/inbox/${notice.id}/read`, { unread: true })).statusCode).toBe(404)
  })

  it('reports how many devices get the person’s notifications', async () => {
    await setup()
    const config = await call(carolId, 'GET', '/push/config')
    await validateResponse('getPushConfig', 200, config.json())
    expect(config.json().data.devices).toBe(1)
    expect((await call(testUserId, 'GET', '/push/config')).json().data.devices).toBe(0)
  })
})
