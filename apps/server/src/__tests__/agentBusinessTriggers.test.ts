import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId } from './helpers'
import { caller, createWorkspace, seedPeople } from './helpers/workspace'
import { tick, RETRY_DELAY_MS } from '../services/agents/runner'
import { unsubscribeBaseUrl } from '../services/agents/suppression'
import { parseAudience, audienceContacts } from '../services/contactAudience'
const app = buildTestApp()
const call = caller(app)
beforeEach(seedPeople)
afterEach(() => vi.unstubAllEnvs())
async function setup(typeKey: string) {
  const ws = await createWorkspace(app, testUserId, { name: 'Triggers' })
  const created = await call(testUserId, 'POST', `/workspaces/${ws.id}/agents`, { typeKey })
  expect(created.statusCode, created.body).toBe(201)
  const agent = created.json().data
  return { ws, agent, url: `/workspaces/${ws.id}/agents/${agent.id}` }
}
async function publish(url: string) {
  const res = await call(testUserId, 'POST', `${url}/publish`)
  expect(res.statusCode, res.body).toBe(200)
}
async function createContact(workspaceId: string, extra = {}) {
  const res = await call(testUserId, 'POST', `/workspaces/${workspaceId}/contacts`, { displayName: 'Customer', points: [{ kind: 'email', value: 'customer@example.com' }], ...extra })
  expect(res.statusCode, res.body).toBe(201)
  return res.json().data
}
async function signal(workspaceId: string, contactId: string, kind: string, sourceKey: string, occurredAt: Date, extra = {}) {
  return call(testUserId, 'POST', `/workspaces/${workspaceId}/agent-business-events`, { contactId, kind, sourceKey, occurredAt: occurredAt.toISOString(), ...extra })
}

describe('business trigger production and mandatory suppression', () => {
  it('uses a configured open pipeline default and fails closed when none exists', async () => {
    const { ws } = await setup('company_newsletter')
    const first = await db.pipelineStage.findFirstOrThrow({ where: { workspaceId: ws.id, archived: false, kind: 'open' }, orderBy: { position: 'asc' } })
    expect((await createContact(ws.id)).leadStatus).toBe(first.key)
    await db.pipelineStage.updateMany({ where: { workspaceId: ws.id }, data: { archived: true } })
    await db.pipelineStage.create({ data: { workspaceId: ws.id, key: 'inquiry', label: 'Inquiry', kind: 'open', position: 0 } })
    expect((await createContact(ws.id)).leadStatus).toBe('inquiry')
    await db.pipelineStage.updateMany({ where: { workspaceId: ws.id }, data: { archived: true } })
    const failed = await call(testUserId, 'POST', `/workspaces/${ws.id}/contacts`, { displayName: 'No stage' })
    expect(failed.json().code).toBe('NO_DEFAULT_STAGE')
  })

  it('produces stage and customer events transactionally, never daily empty-context runs', async () => {
    const { ws, agent, url } = await setup('welcome_new_customer')
    await publish(url)
    expect(await db.agentEvent.count({ where: { agentId: agent.id } })).toBe(0)
    const stageAgent = (await call(testUserId, 'POST', `/workspaces/${ws.id}/agents`, { typeKey: 'followup_status_change' })).json().data
    await publish(`/workspaces/${ws.id}/agents/${stageAgent.id}`)
    await db.pipelineStage.create({ data: { workspaceId: ws.id, key: 'paid', label: 'Paid customer', kind: 'won', position: 5 } })
    const c = await createContact(ws.id)
    const edit = await call(testUserId, 'PATCH', `/workspaces/${ws.id}/contacts/${c.id}`, { expectedVersion: c.version, leadStatus: 'paid' })
    expect(edit.statusCode, edit.body).toBe(200)
    expect(await db.agentBusinessEvent.count({ where: { workspaceId: ws.id } })).toBe(2)
    expect(await db.agentEvent.count({ where: { workspaceId: ws.id } })).toBe(2)
    const stale = await call(testUserId, 'PATCH', `/workspaces/${ws.id}/contacts/${c.id}`, { expectedVersion: c.version, leadStatus: 'paid' })
    expect(stale.statusCode).toBe(409)
    const noChange = await call(testUserId, 'PATCH', `/workspaces/${ws.id}/contacts/${c.id}`, { expectedVersion: edit.json().data.version, leadStatus: 'paid' })
    expect(noChange.statusCode).toBe(200)
    expect(await db.agentEvent.count({ where: { workspaceId: ws.id } })).toBe(2)
    await tick(new Date(Date.now() + 1000))
    expect(await db.agentEvent.count({ where: { workspaceId: ws.id, status: 'completed' } })).toBe(2)
    expect(await db.devOutboxEmail.count()).toBe(2)
    expect(await db.agentEvent.count({ where: { workspaceId: ws.id, status: 'scheduled' } })).toBe(0)
  })

  it('produces welcome events from Customer category and stage changes through bulk edits', async () => {
    const { ws, agent, url } = await setup('welcome_new_customer')
    await publish(url)
    const c = await createContact(ws.id)
    const customer = await db.tag.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: ws.id, name: 'Customer' } } })
    const updated = await call(testUserId, 'PATCH', `/workspaces/${ws.id}/contacts/${c.id}`, { expectedVersion: c.version, tagIds: [customer.id] })
    expect(updated.statusCode, updated.body).toBe(200)
    expect(await db.agentEvent.count({ where: { agentId: agent.id } })).toBe(1)
    const stageAgent = (await call(testUserId, 'POST', `/workspaces/${ws.id}/agents`, { typeKey: 'followup_status_change' })).json().data
    await publish(`/workspaces/${ws.id}/agents/${stageAgent.id}`)
    const bulk = await call(testUserId, 'POST', `/workspaces/${ws.id}/contacts/bulk`, { ids: [c.id], action: 'setStage', leadStatus: 'interested' })
    expect(bulk.statusCode, bulk.body).toBe(200)
    expect(await db.agentEvent.count({ where: { agentId: stageAgent.id } })).toBe(1)
  })

  it('waits N days without a reply, dedupes event replay, and cancels on replies or superseding outreach', async () => {
    const { ws, agent, url } = await setup('checkin_no_reply')
    await call(testUserId, 'PATCH', url, { trigger: { delayDays: 0, noReplyDays: 3 } })
    await publish(url)
    const c = await createContact(ws.id)
    const at = new Date(Date.now() + 10)
    const first = await signal(ws.id, c.id, 'outreach_sent', 'outreach-1', at)
    expect(first.statusCode, first.body).toBe(201)
    expect((await signal(ws.id, c.id, 'outreach_sent', 'outreach-1', at)).json().data.id).toBe(first.json().data.id)
    const event = await db.agentEvent.findFirstOrThrow({ where: { agentId: agent.id } })
    expect(event.scheduledFor.getTime()).toBe(at.getTime() + 3 * 86400000)
    expect((await signal(ws.id, c.id, 'reply_received', 'reply-1', new Date(at.getTime() + 1))).statusCode).toBe(201)
    await tick(event.scheduledFor)
    expect(await db.agentEvent.findUnique({ where: { id: event.id } })).toMatchObject({ status: 'canceled' })
    expect(await db.agentEventTarget.count()).toBe(0)
    await signal(ws.id, c.id, 'outreach_sent', 'outreach-2', new Date(at.getTime() + 2))
    await signal(ws.id, c.id, 'outreach_sent', 'outreach-3', new Date(at.getTime() + 3))
    await tick(new Date(event.scheduledFor.getTime() + 10))
    expect(await db.agentEvent.count({ where: { agentId: agent.id, status: 'canceled' } })).toBe(2)
    expect(await db.devOutboxEmail.count()).toBe(1)
  })

  it('records job completions once, rejects foreign contacts, and keeps independent delayed events', async () => {
    const { ws, agent, url } = await setup('checkin_after_service')
    await call(testUserId, 'PATCH', url, { trigger: { delayDays: 1, noReplyDays: 7 } })
    await publish(url)
    const c = await createContact(ws.id)
    const at = new Date(Date.now() + 10)
    const a = await signal(ws.id, c.id, 'job_completed', 'job-a', at, { jobId: 'J-1' })
    expect(a.statusCode, a.body).toBe(201)
    expect((await signal(ws.id, c.id, 'job_completed', 'job-a-retry', at, { jobId: 'J-1' })).statusCode).toBe(201)
    await signal(ws.id, c.id, 'job_completed', 'job-b', at, { jobId: 'J-2' })
    expect(await db.agentEvent.count({ where: { agentId: agent.id } })).toBe(2)
    const other = await createWorkspace(app, testUserId, { name: 'Other' })
    const foreign = await createContact(other.id)
    expect((await signal(ws.id, foreign.id, 'job_completed', 'foreign', at, { jobId: 'J-3' })).statusCode).toBe(400)
    await tick(new Date(at.getTime() + 86400000))
    expect(await db.agentEvent.count({ where: { agentId: agent.id, status: 'completed' } })).toBe(2)
  })

  it('suppresses normalized addresses before freeze and honors unsubscribe during frozen retries', async () => {
    const { ws, agent, url } = await setup('company_newsletter')
    const blocked = await createContact(ws.id, { points: [{ kind: 'email', value: 'blocked@example.com' }] })
    const retry = await createContact(ws.id, { points: [{ kind: 'email', value: 'fail.transient@example.com' }] })
    const suppression = await call(testUserId, 'POST', `/workspaces/${ws.id}/agent-suppressions`, { address: 'BLOCKED@example.com', reason: 'manual' })
    expect(suppression.statusCode, suppression.body).toBe(201)
    await call(testUserId, 'PATCH', url, { recipientConfig: { source: 'CONTACTS' } })
    await publish(url)
    const event = await db.agentEvent.findFirstOrThrow({ where: { agentId: agent.id, status: 'scheduled' } })
    await tick(event.scheduledFor)
    const targets = await db.agentEventTarget.findMany({ where: { delivery: { eventId: event.id } } })
    expect(targets.find(t => t.contactId === blocked.id)).toMatchObject({ status: 'skipped', failureCode: 'SUPPRESSED', html: '', text: '' })
    const frozen = targets.find(t => t.contactId === retry.id)!
    const token = /agent-unsubscribe\/([a-f0-9]{64})/.exec(frozen.text)![1]!
    expect((await app.inject({ method: 'GET', url: `/agent-unsubscribe/${token}` })).statusCode).toBe(200)
    expect(await db.agentEmailSuppression.count()).toBe(1)
    const posted = await app.inject({ method: 'POST', url: `/agent-unsubscribe/${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' })
    expect(posted.statusCode, posted.body).toBe(200)
    expect((await app.inject({ method: 'POST', url: `/agent-unsubscribe/${token}` })).statusCode).toBe(200)
    await tick(new Date(event.scheduledFor.getTime() + RETRY_DELAY_MS))
    expect(await db.agentEventTarget.findUnique({ where: { id: frozen.id } })).toMatchObject({ status: 'skipped', attempts: 1, failureCode: 'SUPPRESSED' })
    expect(await db.devOutboxEmail.count()).toBe(0)
  })

  it('rejects malformed/OR-group audiences, applies OR values within tags, and requires production unsubscribe configuration', async () => {
    const { ws } = await setup('company_newsletter')
    for (const c of [{ source: 'CONTACTS', groups: [] }, { source: 'CONTACTS', filters: { attributes: [] } }, { source: 'CONTACTS', filters: { tags: [] } }]) expect(() => parseAudience(c)).toThrow()
    const tags = await db.tag.findMany({ where: { workspaceId: ws.id }, take: 2 })
    const a = await createContact(ws.id, { tagIds: [tags[0]!.id] })
    const b = await createContact(ws.id, { tagIds: [tags[1]!.id] })
    const selected = await audienceContacts(ws.id, { source: 'CONTACTS', filters: { tags: tags.map(t => t.name) } })
    expect(selected.map(c => c.id).sort()).toEqual([a.id, b.id].sort())
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PUBLIC_API_URL', '')
    expect(() => unsubscribeBaseUrl()).toThrow()
  })
})
