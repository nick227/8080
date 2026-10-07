// Agents S1 (docs/agents/06, roadmap S1): the Team family end to end — catalog, a
// draft straight from Add agent, editing, publish/pause, one event that emails every
// member and posts to company chat (destinations failing independently), preview,
// Send test, the activity river, event detail, cancel, delete vs archive.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, validateResponse, testUserId, seedBotUser } from './helpers'
import { caller, carolId, createWorkspace, join, seedPeople } from './helpers/workspace'
import { startWorkspaceHost } from '../services/WorkspaceHost'
import { tick } from '../services/agents/runner'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'

const app = buildTestApp()
const call = caller(app)
let host: ReturnType<typeof startWorkspaceHost>
beforeAll(() => {
  host = startWorkspaceHost()
})
afterAll(() => host.stop())
// The host welcomes new members asynchronously; let it finish before the tables are wiped.
afterEach(() => host.idle())

beforeEach(async () => {
  await seedBotUser({ handle: 'chatbot', name: 'chatbot' })
  await seedPeople()
})

const NY = 'America/New_York'

async function workspace() {
  const ws = await createWorkspace(app, testUserId, { name: 'Acme Co', timezone: NY })
  await join(app, ws.id, carolId, 'carol@test.local')
  await host.idle()
  return ws
}

const base = (wsId: string) => `/workspaces/${wsId}`

async function addAgent(wsId: string, typeKey = 'daily_team_brief') {
  const res = await call(testUserId, 'POST', `${base(wsId)}/agents`, { typeKey })
  expect(res.statusCode).toBe(201)
  return res.json().data
}

/** Publishes, then makes the upcoming event an extra one due at `at` (so tests needn't wait for 8 AM). */
async function publishDueAt(wsId: string, agentId: string, at: Date) {
  const res = await call(testUserId, 'POST', `${base(wsId)}/agents/${agentId}/publish`)
  expect(res.statusCode).toBe(200)
  const ev = await db.agentEvent.findFirstOrThrow({ where: { agentId, status: 'scheduled' } })
  await db.agentEvent.update({ where: { id: ev.id }, data: { scheduledFor: at, occurrenceKey: `test:${at.toISOString()}` } })
  return ev.id
}

describe('team agents: catalog and lifecycle', () => {
  it('Add agent lists both team agents; adding one makes a ready draft; members can only look', async () => {
    const ws = await workspace()
    const types = await call(carolId, 'GET', `${base(ws.id)}/agent-types`)
    expect(types.statusCode).toBe(200)
    await validateResponse('listAgentTypes', 200, types.json())
    expect(types.json().data.map((t: any) => t.key)).toEqual(['daily_team_brief', 'daily_customer_report'])
    expect((await call(carolId, 'POST', `${base(ws.id)}/agents`, { typeKey: 'daily_team_brief' })).statusCode).toBe(403)
    expect((await call(testUserId, 'POST', `${base(ws.id)}/agents`, { typeKey: 'company_newsletter' })).json().code).toBe('UNKNOWN_AGENT_TYPE')

    const res = await call(testUserId, 'POST', `${base(ws.id)}/agents`, { typeKey: 'daily_team_brief' })
    expect(res.statusCode).toBe(201)
    await validateResponse('createAgent', 201, res.json())
    expect(res.json().data).toMatchObject({
      name: 'Daily team brief',
      family: 'team',
      status: 'draft',
      destinations: ['email', 'internal_chat'],
      schedule: { repeat: 'daily', time: '08:00' },
      include: ['activity', 'followUpsDue', 'agentFailures', 'inventoryAlerts'],
      templateKey: 'team_brief',
      sender: { mode: 'platform', label: 'Send with 8080' },
      recipientCount: 2,
      nextEvent: null,
      problems: [],
    })
    const list = await call(carolId, 'GET', `${base(ws.id)}/agents`)
    await validateResponse('listAgents', 200, list.json())
    expect(list.json().data).toHaveLength(1)
  })

  it('edits are validated; publish schedules the next local 8 AM; pause removes it; publish resumes', async () => {
    const ws = await workspace()
    const agent = await addAgent(ws.id)
    const url = `${base(ws.id)}/agents/${agent.id}`
    for (const [body, message] of [
      [{ destinations: [] }, 'Choose email, company chat, or both'],
      [{ include: [] }, 'Include at least one section'],
      [{ include: ['salesForecast'] }, 'Unknown section'],
      [{ schedule: { repeat: 'weekly', weekday: 1, time: '08:00' } }, 'Daily reports repeat daily'],
      [{ schedule: { repeat: 'daily', time: '8am' } }, null],
    ] as const) {
      const res = await call(testUserId, 'PATCH', url, body)
      expect(res.statusCode).toBe(400)
      if (message) expect(res.json()).toMatchObject({ code: 'INVALID_AGENT', error: message })
    }
    const edit = await call(testUserId, 'PATCH', url, { name: 'Morning brief', destinations: ['internal_chat'], schedule: { repeat: 'daily', time: '07:30', weekdaysOnly: true }, themeKey: 'warm' })
    expect(edit.statusCode).toBe(200)
    await validateResponse('updateAgent', 200, edit.json())
    expect(edit.json().data).toMatchObject({ name: 'Morning brief', destinations: ['internal_chat'], themeKey: 'warm', schedule: { time: '07:30', weekdaysOnly: true } })
    expect((await call(carolId, 'PATCH', url, { name: 'x' })).statusCode).toBe(403)

    const published = await call(testUserId, 'POST', `${url}/publish`)
    await validateResponse('publishAgent', 200, published.json())
    const next = published.json().data.nextEvent
    expect(published.json().data.status).toBe('active')
    expect(next).toMatchObject({ status: 'scheduled', label: 'Posting to company chat' })
    const local = new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(next.scheduledFor))
    expect(local.find((p) => p.type === 'hour')!.value + ':' + local.find((p) => p.type === 'minute')!.value).toBe('07:30')
    expect(['Sat', 'Sun']).not.toContain(local.find((p) => p.type === 'weekday')!.value)

    // Changing the time moves the one upcoming event.
    await call(testUserId, 'PATCH', url, { schedule: { repeat: 'daily', time: '09:15' } })
    const upcoming = await db.agentEvent.findMany({ where: { agentId: agent.id, status: 'scheduled' } })
    expect(upcoming).toHaveLength(1)
    expect(upcoming[0]!.occurrenceKey.endsWith('T09:15')).toBe(true)

    const paused = await call(testUserId, 'POST', `${url}/pause`)
    await validateResponse('pauseAgent', 200, paused.json())
    expect(paused.json().data).toMatchObject({ status: 'paused', nextEvent: null })
    expect((await call(testUserId, 'POST', `${url}/pause`)).statusCode).toBe(409)
    expect((await call(testUserId, 'POST', `${url}/publish`)).json().data.nextEvent).not.toBeNull()
    expect(await db.actionExecution.count({ where: { workspaceId: ws.id, action: { startsWith: 'agent.' } } })).toBeGreaterThanOrEqual(5)
  })

  it('a draft with no history is deleted; an agent with history is archived and stops', async () => {
    const ws = await workspace()
    const draft = await addAgent(ws.id)
    const del = await call(testUserId, 'DELETE', `${base(ws.id)}/agents/${draft.id}`)
    await validateResponse('deleteAgent', 200, del.json())
    expect(del.json().data.result).toBe('deleted')
    expect(await db.agent.count({ where: { id: draft.id } })).toBe(0)

    const ran = await addAgent(ws.id)
    const due = new Date(Date.now() - 1000)
    await publishDueAt(ws.id, ran.id, due)
    await tick(new Date())
    const archived = await call(testUserId, 'DELETE', `${base(ws.id)}/agents/${ran.id}`)
    expect(archived.json().data.result).toBe('archived')
    expect(await db.agentEvent.count({ where: { agentId: ran.id, status: 'scheduled' } })).toBe(0)
    expect((await call(testUserId, 'GET', `${base(ws.id)}/agents`)).json().data).toEqual([])
    expect((await call(testUserId, 'PATCH', `${base(ws.id)}/agents/${ran.id}`, { name: 'x' })).statusCode).toBe(409)
  })
})

describe('team agents: delivery', () => {
  async function seedBusiness(wsId: string) {
    const now = Date.now()
    const sarah = await db.contact.create({ data: { workspaceId: wsId, displayName: 'Sarah Martinez', nextFollowUp: new Date(now - 60_000) } })
    await db.contact.create({ data: { workspaceId: wsId, displayName: 'Old Lead', createdAt: new Date(now - 40 * 86_400_000), lastActivityAt: new Date(now - 35 * 86_400_000) } })
    await db.inventory.create({ data: { workspaceId: wsId, name: 'Blue tee (L)', quantity: 2, lowStockThreshold: 5, lowStock: true } })
    await db.activityEvent.create({ data: { workspaceId: wsId, type: 'contact.attention', title: 'Sarah asked for a quote', summary: '', sourceType: 'contact', sourceId: sarah.id, dedupeKey: `t:${sarah.id}`, itemId: null } })
    await db.actionExecution.create({
      data: { workspaceId: wsId, action: 'contact.update', actorKind: 'system', origin: 'ui', status: 'succeeded', targetType: 'contact', targetId: sarah.id, input: {}, changes: { leadStatus: ['qualified', 'customer'] } },
    })
    return { sarah }
  }

  it('one event emails every member and posts the same facts to company chat', async () => {
    const ws = await workspace()
    const { sarah } = await seedBusiness(ws.id)
    const agent = await addAgent(ws.id)
    const at = new Date()
    const eventId = await publishDueAt(ws.id, agent.id, at)
    expect(await tick(new Date(at.getTime() + 1))).toEqual([eventId])

    const mail = await db.devOutboxEmail.findMany({ orderBy: { to: 'asc' } })
    expect(mail.map((m) => m.to)).toEqual(['alice@test.local', 'carol@test.local'])
    expect(mail[0]!.subject).toMatch(/^Daily team brief · [A-Z][a-z]{2} \d+$/)
    expect(mail[0]!.from).toBe('"Acme Co" <agents@8080.localhost>')
    for (const fact of ['Sarah asked for a quote', 'Sarah Martinez', 'Blue tee (L) · 2 left (alert at 5)']) {
      expect(mail[0]!.html).toContain(fact)
      expect(mail[0]!.text).toContain(fact)
    }

    const channel = await db.workspaceChannel.findUniqueOrThrow({ where: { workspaceId: ws.id } })
    const post = await db.item.findFirstOrThrow({ where: { roomId: channel.roomId, message: { text: { startsWith: 'Daily team brief · ' } } }, include: { message: { include: { author: true } } } })
    expect(post.message.text).toMatch(/^Daily team brief · \w+day, \w+ \d+\. Important activity: 1 \(Sarah asked for a quote\)\. Follow-ups due: 1 \(Sarah Martinez\)\. Low stock: 1 \(Blue tee \(L\) · 2 left \(alert at 5\)\)\. Nothing else needs attention\.$/)
    expect(post.message.text).not.toContain('\n')
    expect(post.message.author.id).toBe((await db.bot.findUniqueOrThrow({ where: { handle: 'chatbot' } })).userId) // the host, not a member
    expect(JSON.stringify(post.message)).toContain(sarah.id) // contact link

    const river = await call(carolId, 'GET', `${base(ws.id)}/agent-events`)
    await validateResponse('listAgentEvents', 200, river.json())
    const [upcoming, done] = river.json().data
    expect(upcoming).toMatchObject({ status: 'scheduled', label: 'Emailing 2 team members · Posting to company chat' })
    expect(done).toMatchObject({ id: eventId, status: 'completed', label: 'Emailed 2 team members · Posted to company chat', counts: { sent: 3, failed: 0 } })

    const detail = await call(carolId, 'GET', `${base(ws.id)}/agent-events/${eventId}`)
    await validateResponse('getAgentEvent', 200, detail.json())
    expect(detail.json().data).toMatchObject({ issues: [], sender: { strategy: 'platform', displayName: 'Acme Co' } })
    expect(detail.json().data.preview.chat).toMatch(/^Daily team brief · /)
    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('company chat failing does not stop the email; the failure is visible on its own', async () => {
    const ws = await workspace()
    const agent = await addAgent(ws.id, 'daily_customer_report')
    await db.bot.update({ where: { handle: 'chatbot' }, data: { enabled: false } })
    const eventId = await publishDueAt(ws.id, agent.id, new Date(Date.now() - 1000))
    await tick(new Date())
    const event = await db.agentEvent.findUniqueOrThrow({ where: { id: eventId } })
    expect(event).toMatchObject({ status: 'completed', successCount: 2, failureCount: 1, failureCode: 'CHAT_UNAVAILABLE' })
    const detail = (await call(testUserId, 'GET', `${base(ws.id)}/agent-events/${eventId}`)).json().data
    expect(detail.label).toBe('Emailed 2 team members · Company chat failed')
    expect(detail.issues).toEqual([expect.objectContaining({ destination: 'internal_chat', status: 'failed', failureCode: 'CHAT_UNAVAILABLE' })])
    expect(await db.activityEvent.count({ where: { sourceId: eventId, type: 'agent.failed' } })).toBe(1)
    expect(await db.devOutboxEmail.count()).toBe(2)
  })

  it('the customer report counts new contacts, stage changes, follow-ups and quiet contacts', async () => {
    const ws = await workspace()
    await seedBusiness(ws.id)
    const agent = await addAgent(ws.id, 'daily_customer_report')
    const preview = await call(carolId, 'GET', `${base(ws.id)}/agents/${agent.id}/preview`)
    expect(preview.statusCode).toBe(200)
    await validateResponse('previewAgent', 200, preview.json())
    const counts = Object.fromEntries(preview.json().data.sections.map((s: any) => [s.key, s.count]))
    expect(counts).toEqual({ newContacts: 1, stageChanges: 1, followUpsDue: 1, needsAttention: 1 })
    expect(preview.json().data.text).toContain('Sarah Martinez · Qualified → Customer')
    expect(preview.json().data.chat).toContain('Daily customer report · ')
    expect(preview.json().data.chat).toContain('Stage changes: 1 (Sarah Martinez · Qualified → Customer)')
    expect(preview.json().data.recipientCount).toBe(2)
    expect(await db.agentEvent.count()).toBe(0)
  })

  it('Send test emails only the caller, marked as a test, and creates no event or chat post', async () => {
    const ws = await workspace()
    const agent = await addAgent(ws.id)
    const res = await call(testUserId, 'POST', `${base(ws.id)}/agents/${agent.id}/test`)
    expect(res.statusCode).toBe(200)
    await validateResponse('sendAgentTest', 200, res.json())
    expect(res.json().data).toMatchObject({ ok: true, sentTo: 'alice@test.local', error: null })
    expect(res.json().data.providerMessageId).toMatch(/^dev:/)
    const mail = await db.devOutboxEmail.findMany()
    expect(mail).toHaveLength(1)
    expect(mail[0]!.subject.startsWith('[Test] Daily team brief')).toBe(true)
    expect(await db.agentEvent.count()).toBe(0)
    expect((await call(carolId, 'POST', `${base(ws.id)}/agents/${agent.id}/test`)).statusCode).toBe(403)
  })

  it('cancel stops an upcoming event and the schedule moves on; the river pages', async () => {
    const ws = await workspace()
    const agent = await addAgent(ws.id)
    await call(testUserId, 'POST', `${base(ws.id)}/agents/${agent.id}/publish`)
    const first = await db.agentEvent.findFirstOrThrow({ where: { agentId: agent.id, status: 'scheduled' } })
    const res = await call(testUserId, 'POST', `${base(ws.id)}/agent-events/${first.id}/cancel`)
    expect(res.statusCode).toBe(200)
    await validateResponse('cancelAgentEvent', 200, res.json())
    expect(res.json().data).toMatchObject({ status: 'canceled', label: 'Canceled — Canceled by a person.' })
    expect((await call(testUserId, 'POST', `${base(ws.id)}/agent-events/${first.id}/cancel`)).statusCode).toBe(409)
    const next = await db.agentEvent.findFirstOrThrow({ where: { agentId: agent.id, status: 'scheduled' } })
    expect(next.scheduledFor.getTime() - first.scheduledFor.getTime()).toBe(24 * 3600_000)

    const page1 = (await call(testUserId, 'GET', `${base(ws.id)}/agent-events?limit=1`)).json()
    expect(page1.data.map((e: any) => e.id)).toEqual([next.id])
    const page2 = (await call(testUserId, 'GET', `${base(ws.id)}/agent-events?limit=1&cursor=${page1.meta.nextCursor}`)).json()
    expect(page2.data.map((e: any) => e.id)).toEqual([first.id])
    expect(page2.meta.hasMore).toBe(false)

    const other = await createWorkspace(app, carolId, { name: 'Other' })
    expect((await call(carolId, 'GET', `/workspaces/${other.id}/agent-events/${first.id}`)).statusCode).toBe(404)
  })
})
