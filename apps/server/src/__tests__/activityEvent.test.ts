// Workspace ActivityEvent → one shared channel line (doc/11 revised).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId, seedBotUser } from './helpers'
import { caller, carolId, createWorkspace, join, seedPeople } from './helpers/workspace'
import { startWorkspaceHost } from '../services/WorkspaceHost'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'

const app = buildTestApp()
const call = caller(app)
let host: ReturnType<typeof startWorkspaceHost>
beforeAll(() => { host = startWorkspaceHost() })
afterAll(() => host.stop())

beforeEach(async () => {
  await seedBotUser({ handle: 'chatbot', name: 'chatbot' })
})

describe('activity events', () => {
  it('records one workspace event and posts one channel line for a new contact', async () => {
    const ws = await createWorkspace(app)
    await seedPeople()
    await join(app, ws.id, carolId, 'carol@test.local')
    await host.idle()

    const created = await call(testUserId, 'POST', `/workspaces/${ws.id}/contacts`, {
      displayName: 'Sarah Martinez',
      points: [{ kind: 'email', value: 'sarah@example.com' }],
    })
    expect(created.statusCode).toBe(201)
    const contactId = created.json().data.id as string
    await host.idle()

    const events = await db.activityEvent.findMany({ where: { workspaceId: ws.id, type: 'contact.attention' } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      sourceType: 'contact',
      sourceId: contactId,
      title: 'New contact — Sarah Martinez',
      dedupeKey: `contact:${contactId}:created`,
    })
    expect(events[0]!.itemId).toEqual(expect.any(String))

    const channel = await db.workspaceChannel.findUniqueOrThrow({ where: { workspaceId: ws.id } })
    const item = await db.item.findUniqueOrThrow({ where: { id: events[0]!.itemId! }, include: { message: true } })
    expect(item.roomId).toBe(channel.roomId)
    expect(item.message.workflow).toBe('workspace-activity')
    expect(item.message.text).toContain('Sarah Martinez')
    expect(item.message.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'contact', id: contactId }),
      expect.objectContaining({ type: 'compose', id: contactId }),
    ]))

    // A retry of the same business key does not mint a second channel line.
    const { recordActivityEvent } = await import('../services/activityEvent')
    await recordActivityEvent({
      workspaceId: ws.id,
      type: 'contact.attention',
      title: 'New contact — Sarah Martinez',
      summary: 'dup',
      sourceType: 'contact',
      sourceId: contactId,
      dedupeKey: `contact:${contactId}:created`,
    })
    expect(await db.activityEvent.count({ where: { workspaceId: ws.id, type: 'contact.attention' } })).toBe(1)
    expect(await db.item.count({ where: { id: events[0]!.itemId! } })).toBe(1)
    expect(await db.inboxItem.count({ where: { workspaceId: ws.id, title: { startsWith: 'New contact' } } })).toBe(0)
    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('records a follow-up without fanning inbox rows', async () => {
    const ws = await createWorkspace(app)
    await seedPeople()
    await join(app, ws.id, carolId, 'carol@test.local')
    const contact = (await call(testUserId, 'POST', `/workspaces/${ws.id}/contacts`, { displayName: 'Dana' })).json().data
    await host.idle()
    const sent = await call(testUserId, 'POST', `/workspaces/${ws.id}/compose`, {
      contactId: contact.id, channel: 'email', destination: 'dana@acme.com', subject: 'Hello', body: 'See you', contextType: 'contact', contextId: contact.id,
    })
    expect(sent.statusCode).toBe(201)
    await host.idle()
    const event = await db.activityEvent.findFirst({ where: { workspaceId: ws.id, type: 'compose.follow_up' } })
    expect(event).toMatchObject({ title: 'Follow-up: Hello', sourceId: contact.id })
    expect(event?.itemId).toEqual(expect.any(String))
    expect(await db.inboxItem.count({ where: { workspaceId: ws.id, title: 'Follow-up: Hello' } })).toBe(0)
  })
})
