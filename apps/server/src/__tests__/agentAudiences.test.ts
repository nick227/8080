import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId, validateResponse } from './helpers'
import { caller, createWorkspace, seedPeople, carolId } from './helpers/workspace'
import { audienceContacts } from '../services/contactAudience'
import { tick, RETRY_DELAY_MS } from '../services/agents/runner'

const app = buildTestApp()
const call = caller(app)
beforeEach(seedPeople)
async function setup(typeKey = 'company_newsletter') {
  const ws = await createWorkspace(app, testUserId, { name: 'Audience test' })
  const response = await call(testUserId, 'POST', `/workspaces/${ws.id}/agents`, { typeKey })
  expect(response.statusCode).toBe(201)
  await validateResponse('createAgent', 201, response.json())
  return { ws, agent: response.json().data, url: `/workspaces/${ws.id}/agents/${response.json().data.id}` }
}
async function contact(workspaceId: string, displayName: string, extra: Record<string, any> = {}) {
  return db.contact.create({ data: { workspaceId, displayName, primaryEmail: `${displayName}@example.com`, ...extra } })
}
async function due(agentId: string, workspaceId: string, context?: { contactId: string }) {
  await db.agent.update({ where: { id: agentId }, data: { status: 'active' } })
  return db.agentEvent.create({ data: { workspaceId, agentId, scheduledFor: new Date('2026-10-01T09:00:00Z'), occurrenceKey: 'audience-test', context } })
}

describe('deterministic Agent audiences', () => {
  it('requires deliberate TO, blocks legacy member audiences, and rejects unsupported destinations', async () => {
    const { ws, agent, url } = await setup()
    expect(agent).toMatchObject({ recipientConfig: null, recipientCount: 0 })
    expect((await call(testUserId, 'POST', `${url}/publish`)).statusCode).toBe(400)
    expect((await call(testUserId, 'PATCH', url, { destinations: ['email', 'internal_chat'] })).statusCode).toBe(400)
    expect((await call(testUserId, 'GET', `${url}/preview`)).statusCode).toBe(200)
    await db.agent.update({ where: { id: agent.id }, data: { recipientConfig: { source: 'WORKSPACE_MEMBERS' } } })
    const event = await due(agent.id, ws.id)
    await tick(event.scheduledFor)
    expect(await db.agentEvent.findUnique({ where: { id: event.id } })).toMatchObject({ failureCode: 'MISSING_AUDIENCE' })
    expect(await db.agentEventTarget.count()).toBe(0)
  })

  it('composes category, pipeline, location, tags, assignment, email, dates, and typed custom fields; Contacts uses exactly the same audience', async () => {
    const { ws, url } = await setup()
    const other = await createWorkspace(app, testUserId, { name: 'Other workspace' })
    const member = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: ws.id, userId: testUserId } })
    await db.contactFieldDefinition.create({ data: { workspaceId: ws.id, key: 'poolSize', label: 'Pool size', type: 'number' } })
    const customer = await db.tag.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: ws.id, name: 'Customer' } } })
    const tag = await db.tag.create({ data: { workspaceId: ws.id, name: 'Pool cleaning' } })
    const data = { leadStatus: 'qualified', ownerMemberId: member.id, potentialValue: 6000, fieldValues: { location: 'Austin', poolSize: 20 }, lastContactedAt: new Date('2020-01-01') }
    const match = await contact(ws.id, 'match', data)
    await db.contactTag.createMany({ data: [customer, tag].map(t => ({ workspaceId: ws.id, contactId: match.id, tagId: t.id })) })
    await contact(ws.id, 'without-tags', data)
    await contact(ws.id, 'archived', { ...data, status: 'archived' })
    await contact(other.id, 'outsider', { fieldValues: { location: 'Austin', poolSize: 100 } })
    const config = { source: 'CONTACTS', filters: { categories: ['Customer'], stages: ['qualified'], location: ['Austin'], tags: ['Pool cleaning'], assignedTo: [member.id], hasEmail: true, attributes: [{ field: 'potentialValue', op: 'gte', value: 5000 }, { field: 'lastContactedAt', op: 'before_days', value: 30 }, { field: 'poolSize', op: 'gte', value: 10 }] } }
    const preview = await call(testUserId, 'POST', `/workspaces/${ws.id}/agent-audience/preview`, config)
    expect(preview.statusCode, preview.body).toBe(200)
    await validateResponse('previewAgentAudience', 200, preview.json())
    expect(preview.json().data).toMatchObject({ matchedCount: 1, recipientCount: 1, contacts: [{ id: match.id }] })
    const list = await call(testUserId, 'GET', `/workspaces/${ws.id}/contacts?audience=${encodeURIComponent(JSON.stringify(config))}`)
    expect(list.statusCode, list.body).toBe(200)
    expect(list.json().data.map((c: any) => c.id)).toEqual([match.id])
    const saved = await call(testUserId, 'PATCH', url, { recipientConfig: config })
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json().data.recipientCount).toBe(1)
    expect(saved.json().data.recipientConfig).toEqual(config)
    // Location is writable through the existing structured-field path.
    const changed = await call(testUserId, 'PATCH', `/workspaces/${ws.id}/contacts/${match.id}`, { expectedVersion: match.version, fieldValues: { location: 'Dallas' } })
    expect(changed.statusCode, changed.body).toBe(200)
    expect((await audienceContacts(ws.id, config))).toHaveLength(0)
  })

  it('resolves at run time, normalizes duplicate emails, records missing email, and freezes retries', async () => {
    const { ws, agent, url } = await setup()
    const config = { source: 'CONTACTS', filters: { location: ['Austin'] } }
    expect((await call(testUserId, 'PATCH', url, { recipientConfig: config })).statusCode).toBe(200)
    const good = await contact(ws.id, 'good', { fieldValues: { location: 'Austin' } })
    await contact(ws.id, 'duplicate', { primaryEmail: ' GOOD@example.com ', fieldValues: { location: 'Austin' } })
    const retry = await contact(ws.id, 'retry', { primaryEmail: 'fail.transient@example.com', fieldValues: { location: 'Austin' } })
    await contact(ws.id, 'missing', { primaryEmail: null, fieldValues: { location: 'Austin' } })
    const event = await due(agent.id, ws.id)
    await tick(event.scheduledFor)
    const targets = await db.agentEventTarget.findMany({ where: { delivery: { eventId: event.id } } })
    expect(targets).toHaveLength(4)
    expect(targets.filter(t => t.status === 'skipped')).toHaveLength(1)
    expect(targets.find(t => t.failureCode === 'MISSING_EMAIL')).toBeTruthy()
    expect(await db.agentEventDelivery.findMany({ where: { eventId: event.id }, select: { destination: true } })).toEqual([{ destination: 'email' }])
    expect(await db.devOutboxEmail.count()).toBe(1)
    await db.contact.update({ where: { id: retry.id }, data: { primaryEmail: 'changed@example.com', fieldValues: { location: 'Dallas' } } })
    await db.contact.update({ where: { id: good.id }, data: { status: 'archived' } })
    await contact(ws.id, 'late', { fieldValues: { location: 'Austin' } })
    await tick(new Date(event.scheduledFor.getTime() + RETRY_DELAY_MS))
    const frozen = await db.agentEventTarget.findMany({ where: { delivery: { eventId: event.id } } })
    expect(frozen).toHaveLength(4)
    expect(frozen.find(t => t.contactId === retry.id)).toMatchObject({ address: 'fail.transient@example.com', attempts: 2 })
    expect(await db.devOutboxEmail.count()).toBe(1)
  })

  it('selected contacts are unique and workspace-scoped; trigger context never falls back to everyone', async () => {
    const { ws, url } = await setup()
    const c = await contact(ws.id, 'selected')
    const other = await createWorkspace(app, testUserId, { name: 'Elsewhere' })
    const outsider = await contact(other.id, 'outside')
    const selected = { source: 'SELECTED_CONTACTS', ids: [c.id, c.id] }
    expect((await call(testUserId, 'PATCH', url, { recipientConfig: selected })).json().data.recipientCount).toBe(1)
    expect((await call(testUserId, 'PATCH', url, { recipientConfig: { source: 'SELECTED_CONTACTS', ids: [outsider.id] } })).statusCode).toBe(400)
    expect((await call(carolId, 'POST', `/workspaces/${ws.id}/agent-audience/preview`, selected)).statusCode).toBe(404)
    const triggered = await call(testUserId, 'POST', `/workspaces/${ws.id}/agents`, { typeKey: 'welcome_new_customer' })
    expect(triggered.json().data.recipientConfig).toEqual({ source: 'TRIGGER_CONTACT' })
    const ev = await due(triggered.json().data.id, ws.id, { contactId: c.id })
    await tick(ev.scheduledFor)
    expect(await db.agentEventTarget.findMany({ where: { delivery: { eventId: ev.id } }, select: { contactId: true } })).toEqual([{ contactId: c.id }])
    const missing = await db.agentEvent.create({ data: { agentId: triggered.json().data.id, workspaceId: ws.id, occurrenceKey: 'missing-context', scheduledFor: ev.scheduledFor } })
    await tick(ev.scheduledFor)
    expect(await db.agentEventTarget.count({ where: { delivery: { eventId: missing.id } } })).toBe(0)
    expect(await db.agentEvent.findUnique({ where: { id: missing.id } })).toMatchObject({ failureCode: 'MISSING_TRIGGER_CONTACT' })
  })

  it('supports deliberate all, clearing TO, selected creation, and chat-only catalog destinations', async () => {
    const { ws, url } = await setup()
    const c = await contact(ws.id, 'one')
    expect((await call(testUserId, 'PATCH', url, { recipientConfig: { source: 'CONTACTS' } })).json().data.recipientCount).toBe(1)
    const cleared = await call(testUserId, 'PATCH', url, { recipientConfig: null })
    expect(cleared.json().data.recipientConfig).toBeNull()
    expect((await call(testUserId, 'POST', `${url}/publish`)).statusCode).toBe(400)
    const created = await call(testUserId, 'POST', `/workspaces/${ws.id}/agents`, { typeKey: 'company_announcement', recipientConfig: { source: 'SELECTED_CONTACTS', ids: [c.id] } })
    expect(created.statusCode, created.body).toBe(201)
    expect(created.json().data.recipientCount).toBe(1)
    const internal = await call(testUserId, 'POST', `/workspaces/${ws.id}/agents`, { typeKey: 'internal_messages' })
    const edited = await call(testUserId, 'PATCH', `/workspaces/${ws.id}/agents/${internal.json().data.id}`, { destinations: ['internal_chat'] })
    expect(edited.statusCode, edited.body).toBe(200)
    const event = await due(internal.json().data.id, ws.id)
    await tick(event.scheduledFor)
    expect(await db.agentEventDelivery.findMany({ where: { eventId: event.id }, select: { destination: true } })).toEqual([{ destination: 'internal_chat' }])
    expect(await db.devOutboxEmail.count()).toBe(0)
  })

  it('rejects unknown rules and invalid attribute types instead of widening an audience', async () => {
    const { ws } = await setup()
    for (const filters of [{ typo: ['x'] }, { attributes: [{ field: 'unknown', op: 'eq', value: 'x' }] }, { attributes: [{ field: 'potentialValue', op: 'gte', value: '5000' }] }, { attributes: [{ field: 'lastContactedAt', op: 'before_days', value: -1 }] }]) {
      expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/agent-audience/preview`, { source: 'CONTACTS', filters })).statusCode).toBe(400)
    }
  })
})
