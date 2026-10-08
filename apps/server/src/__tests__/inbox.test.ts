// Inbox attention queue and the shared composer (doc/11).
// Alice owns the workspace, Carol is a member. Items are raised by the server, never by a route.
import { randomUUID } from 'crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId, seedBotUser } from './helpers'
import { caller, carolId, createWorkspace, join, memberId, seedPeople } from './helpers/workspace'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'
import { InboxService } from '../services/InboxService'
import { notifyConversation } from '../services/inboxAnnounce'
import { startWorkspaceHost } from '../services/WorkspaceHost'

const app = buildTestApp()
const call = caller(app)
const inbox = new InboxService()
let host: ReturnType<typeof startWorkspaceHost>
beforeAll(() => { host = startWorkspaceHost() })
afterAll(() => host.stop())
beforeEach(async () => {
  await seedBotUser({ handle: 'chatbot', name: 'chatbot' })
})

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  await join(app, ws.id, carolId, 'carol@test.local')
  await host.idle()
  return { ws, alice: await memberId(ws.id, testUserId), carol: await memberId(ws.id, carolId) }
}

function raise(workspaceId: string, memberId: string, dedupeKey: string, title = 'Due now') {
  return inbox.raise(workspaceId, {
    memberId,
    type: 'system',
    title,
    summary: 'A reminder fired',
    sourceType: 'system',
    sourceId: 'evt-1',
    dedupeKey,
    action: { verb: 'open' },
  })
}

describe('inbox', () => {
  it('shows a member only their own items, and no route creates one', async () => {
    const { ws, carol } = await setup()
    const item = await raise(ws.id, carol, 'evt-carol')
    const aliceList = await call(testUserId, 'GET', `/workspaces/${ws.id}/inbox`)
    expect(aliceList.statusCode).toBe(200)
    expect(aliceList.json().data.filter((row: { dedupeKey: string }) => row.dedupeKey === 'evt-carol')).toEqual([])
    const carolList = await call(carolId, 'GET', `/workspaces/${ws.id}/inbox`)
    expect(carolList.json().data.filter((row: { dedupeKey: string }) => row.dedupeKey === 'evt-carol').map((row: { id: string }) => row.id)).toEqual([item.id])
    expect((await call(testUserId, 'PATCH', `/workspaces/${ws.id}/inbox/${item.id}/read`, { unread: false })).statusCode).toBe(404)
    expect((await call(carolId, 'POST', `/workspaces/${ws.id}/inbox`, { title: 'x' })).statusCode).toBe(404)
  })

  it('archives one copy of a fanned-out event and leaves the other', async () => {
    const { ws, alice, carol } = await setup()
    await raise(ws.id, alice, 'same-event')
    const carols = await raise(ws.id, carol, 'same-event')
    const archived = await call(carolId, 'PATCH', `/workspaces/${ws.id}/inbox/${carols.id}/archive`, { archived: true })
    expect(archived.statusCode).toBe(200)
    expect(archived.json().data.archivedAt).toEqual(expect.any(String))
    const carolOpen = (await call(carolId, 'GET', `/workspaces/${ws.id}/inbox`)).json().data.filter((row: { dedupeKey: string }) => row.dedupeKey === 'same-event')
    const carolArchived = (await call(carolId, 'GET', `/workspaces/${ws.id}/inbox?archived=true`)).json().data.filter((row: { dedupeKey: string }) => row.dedupeKey === 'same-event')
    const aliceOpen = (await call(testUserId, 'GET', `/workspaces/${ws.id}/inbox`)).json().data.filter((row: { dedupeKey: string }) => row.dedupeKey === 'same-event')
    expect(carolOpen).toEqual([])
    expect(carolArchived).toHaveLength(1)
    expect(aliceOpen).toHaveLength(1)
  })

  it('returns the original item when the same dedupe key is raised again', async () => {
    const { ws, alice } = await setup()
    const first = await raise(ws.id, alice, 'once', 'First title')
    const second = await raise(ws.id, alice, 'once', 'Second title')
    expect(second.id).toBe(first.id)
    expect(second.title).toBe('First title')
    expect(await db.inboxItem.count({ where: { workspaceId: ws.id, dedupeKey: 'once' } })).toBe(1)
  })

  it('refuses an unknown source', async () => {
    const { ws, alice } = await setup()
    await expect(inbox.raise(ws.id, {
      memberId: alice, type: 'inventory', title: 'Low stock', summary: 'Widgets', sourceType: 'inventory', sourceId: 'sku-1', dedupeKey: 'sku-1', action: { verb: 'open' },
    })).rejects.toMatchObject({ code: 'UNKNOWN_SOURCE' })
  })

  it('records a follow-up on the contact without an inbox fan-out', async () => {
    const { ws } = await setup()
    const contact = (await call(testUserId, 'POST', `/workspaces/${ws.id}/contacts`, { displayName: 'Dana', points: [{ kind: 'email', value: 'dana@acme.com' }] })).json().data
    expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/compose`, { contactId: contact.id, channel: 'email', destination: 'not-an-email', subject: 'Hi', body: 'Hello', contextType: 'contact', contextId: contact.id })).json().code).toBe('INVALID_EMAIL')
    expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/compose`, { contactId: contact.id, channel: 'email', destination: 'dana@acme.com', subject: ' ', body: 'Hello', contextType: 'contact', contextId: contact.id })).json().code).toBe('EMPTY_SUBJECT')

    const sent = await call(testUserId, 'POST', `/workspaces/${ws.id}/compose`, {
      contactId: contact.id, channel: 'email', destination: 'Dana@Acme.com', subject: 'Hello', body: 'See you Thursday', contextType: 'contact', contextId: contact.id,
    })
    expect(sent.statusCode).toBe(201)
    expect(sent.json().data).toMatchObject({ destination: 'dana@acme.com', subject: 'Hello', channel: 'email' })
    expect(await db.compose.count({ where: { workspaceId: ws.id } })).toBe(1)
    const activity = await db.activity.findFirstOrThrow({ where: { workspaceId: ws.id, type: 'compose.recorded' } })
    expect(activity.summary).toMatchObject({ destination: 'dana@acme.com', subject: 'Hello' })
    expect(await db.inboxItem.count({ where: { workspaceId: ws.id, title: 'Follow-up: Hello' } })).toBe(0)
    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('does not raise an inbox row for an ordinary document create', async () => {
    const { ws, alice } = await setup()
    const doc = (await call(testUserId, 'POST', `/workspaces/${ws.id}/documents`, {
      title: 'Brief', descriptor: { surface: 'blocks', source: { kind: 'native', schemaVersion: 1 } }, idempotencyKey: randomUUID(),
    })).json().data
    expect(await db.inboxItem.findFirst({ where: { memberId: alice, sourceId: doc.id } })).toBeNull()
  })

  it('hides a reminder until it is due, and a room note stays inside the room', async () => {
    const { ws, alice, carol } = await setup()
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const waiting = await inbox.raise(ws.id, {
      memberId: alice, type: 'reminder', title: 'Tomorrow', summary: 'Not yet', sourceType: 'system', sourceId: 'later', dedupeKey: 'later', action: { verb: 'open' }, deliverAt: later,
    })
    expect(waiting.deliverAt > new Date().toISOString()).toBe(true)
    expect((await call(testUserId, 'GET', `/workspaces/${ws.id}/inbox`)).json().data.some((row: { id: string }) => row.id === waiting.id)).toBe(false)

    const room = (await call(testUserId, 'POST', '/rooms', { title: 'Standup', visibility: 'private' })).json().data
    const placed = await call(testUserId, 'POST', `/rooms/${room.id}/items`, { text: 'Hello team' })
    expect(placed.statusCode).toBe(201)
    const itemId = placed.json().data.id as string
    const note = await waitFor(() => db.inboxItem.findFirst({ where: { memberId: alice, dedupeKey: itemId } }))
    expect(note).toMatchObject({ type: 'conversation', sourceType: 'conversation', sourceId: room.id, summary: 'Hello team' })
    expect(await db.inboxItem.findFirst({ where: { memberId: carol, dedupeKey: itemId } })).toBeNull()
    await notifyConversation({ roomId: room.id, itemId: 'bot-line', text: 'I can help', actorKind: 'bot', actorUserId: testUserId })
    expect(await db.inboxItem.findFirst({ where: { memberId: alice, dedupeKey: 'bot-line' } })).toMatchObject({ type: 'agent', summary: 'I can help' })
    expect(await db.inboxItem.findFirst({ where: { memberId: carol, dedupeKey: 'bot-line' } })).toBeNull()
  })
})

async function waitFor<T>(load: () => Promise<T | null>) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = await load()
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return null
}
