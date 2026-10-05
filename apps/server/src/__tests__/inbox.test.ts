// Inbox attention queue and the shared composer (doc/11).
// Alice owns the workspace, Carol is a member. Items are raised by the server, never by a route.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId } from './helpers'
import { caller, carolId, createWorkspace, join, memberId, seedPeople } from './helpers/workspace'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'
import { InboxService } from '../services/InboxService'

const app = buildTestApp()
const call = caller(app)
const inbox = new InboxService()

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  await join(app, ws.id, carolId, 'carol@test.local')
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
    expect(aliceList.json().data).toEqual([])
    const carolList = await call(carolId, 'GET', `/workspaces/${ws.id}/inbox`)
    expect(carolList.json().data.map((row: { id: string }) => row.id)).toEqual([item.id])
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
    expect((await call(carolId, 'GET', `/workspaces/${ws.id}/inbox`)).json().data).toEqual([])
    expect((await call(carolId, 'GET', `/workspaces/${ws.id}/inbox?archived=true`)).json().data).toHaveLength(1)
    expect((await call(testUserId, 'GET', `/workspaces/${ws.id}/inbox`)).json().data).toHaveLength(1)
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

  it('records a follow-up on the contact and creates no inbox item', async () => {
    const { ws } = await setup()
    const contact = (await call(testUserId, 'POST', `/workspaces/${ws.id}/contacts`, { displayName: 'Dana', points: [{ kind: 'email', value: 'dana@acme.com' }] })).json().data
    expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/compose`, { contactId: contact.id, channel: 'email', destination: 'not-an-email', subject: 'Hi', body: 'Hello', contextType: 'contact', contextId: contact.id })).json().code).toBe('INVALID_EMAIL')
    expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/compose`, { contactId: contact.id, channel: 'email', destination: 'dana@acme.com', subject: ' ', body: 'Hello', contextType: 'contact', contextId: contact.id })).json().code).toBe('EMPTY_SUBJECT')

    const sent = await call(testUserId, 'POST', `/workspaces/${ws.id}/compose`, {
      contactId: contact.id, channel: 'email', destination: 'Dana@Acme.com', subject: 'Hello', body: 'See you Thursday', contextType: 'contact', contextId: contact.id,
    })
    expect(sent.statusCode).toBe(201)
    expect(sent.json().data).toMatchObject({ destination: 'dana@acme.com', subject: 'Hello', channel: 'email' })
    expect(await db.inboxItem.count({ where: { workspaceId: ws.id } })).toBe(0)
    const activity = await db.activity.findFirstOrThrow({ where: { workspaceId: ws.id, type: 'compose.recorded' } })
    expect(activity.summary).toMatchObject({ destination: 'dana@acme.com', subject: 'Hello' })
    expect(await crossWorkspaceViolations()).toEqual({})
  })
})
