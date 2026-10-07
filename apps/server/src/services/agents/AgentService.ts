// Agents management (docs/agents/01, 05, 06; roadmap S1): the built-in catalog,
// Agent lifecycle (draft → active ⇄ paused → archived), preview, Send test, the
// activity river and event detail. Delivery itself is the runner's job; this layer
// only edits configuration and keeps the one upcoming event in step (scheduleNext).
import { db, Prisma, type Agent, type AgentEvent, type AgentEventDelivery, type EmailConnection } from '@project/db'
import { isEmailTemplateKey, isEmailThemeKey, type EmailTemplateKey, type EmailThemeKey } from '@project/shared'
import { badRequest, conflict, notFound } from '../../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../../lib/pagination'
import type { Recurrence } from '../../lib/recurrence'
import { runAction, type Changes } from '../actions'
import { authorize, type Actor } from '../workspacePolicy'
import { memberActor, type WorkspaceCtx } from '../WorkspaceService'
import { baseValues } from './audiences'
import { agentConnection, toEmailConnection } from './connections'
import { providerFor } from './email'
import { renderEmail } from './presentation'
import { getAgentType, listAgentTypes, type AgentConfig } from './registry'
import { scheduleNext } from './runner'
import { buildReport, teamDelivery, teamFooter, teamRules, teamSpec, type Destination, type TeamDelivery, type TeamRules } from './types/team'

type EventWithDeliveries = AgentEvent & { deliveries: AgentEventDelivery[] }

export type UpdateAgentInput = {
  name?: string
  templateKey?: string
  themeKey?: string
  destinations?: Destination[]
  schedule?: Recurrence
  include?: string[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

async function memberCount(workspaceId: string) {
  return db.workspaceMember.count({ where: { workspaceId, status: 'active', user: { email: { not: null } } } })
}

async function loadAgent(workspaceId: string, agentId: string) {
  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId } })
  if (!agent) throw notFound()
  return agent
}

function typeOf(agent: Agent) {
  const type = getAgentType(agent.typeKey)
  if (!type) throw badRequest('This kind of agent is no longer available', 'UNKNOWN_AGENT_TYPE')
  return type
}

const configOf = (agent: Pick<Agent, 'recipientConfig' | 'deliveryConfig' | 'ruleConfig'>): AgentConfig => ({
  recipientConfig: agent.recipientConfig,
  deliveryConfig: agent.deliveryConfig,
  ruleConfig: agent.ruleConfig,
})

// ─── serialization ─────────────────────────────────────────────────────────────

/** "Emailed 12 team members · Posted to company chat" — the river's action line. */
export function eventLabel(event: EventWithDeliveries, planned: Destination[], members: number): string {
  if (event.status === 'canceled') return event.failureSummary ? `Canceled — ${event.failureSummary}` : 'Canceled'
  if (!event.deliveries.length) {
    if (event.status === 'failed') return event.failureSummary ?? 'Failed'
    return planned.map((d) => (d === 'email' ? `Emailing ${plural(members, 'team member')}` : 'Posting to company chat')).join(' · ')
  }
  const order: Record<string, number> = { email: 0, internal_chat: 1 }
  return [...event.deliveries]
    .sort((a, b) => order[a.destination]! - order[b.destination]!)
    .map((d) => {
      if (d.destination === 'internal_chat') return d.status === 'running' ? 'Posting to company chat' : d.successCount ? 'Posted to company chat' : 'Company chat failed'
      if (d.status === 'running') return `Emailing ${plural(d.targetCount || members, 'team member')}`
      if (!d.successCount && d.failureCount) return `Email failed for ${plural(d.failureCount, 'team member')}`
      return `Emailed ${plural(d.successCount, 'team member')}${d.failureCount ? ` · ${d.failureCount} failed` : ''}`
    })
    .join(' · ')
}

function toEventSummary(event: EventWithDeliveries, agent: Pick<Agent, 'id' | 'name' | 'typeKey' | 'deliveryConfig'>, members: number) {
  const planned = (agent.deliveryConfig as Partial<TeamDelivery>)?.destinations ?? []
  return {
    id: event.id,
    agentId: agent.id,
    agentName: agent.name,
    typeKey: agent.typeKey,
    status: event.status,
    scheduledFor: event.scheduledFor,
    startedAt: event.startedAt,
    completedAt: event.completedAt,
    label: eventLabel(event, planned, members),
    counts: { targets: event.targetCount, sent: event.successCount, failed: event.failureCount, skipped: event.skippedCount },
    deliveries: event.deliveries.map((d) => ({
      destination: d.destination,
      status: d.status,
      targetCount: d.targetCount,
      successCount: d.successCount,
      failureCount: d.failureCount,
      skippedCount: d.skippedCount,
      failureSummary: d.failureSummary,
    })),
    failureCode: event.failureCode,
    failureSummary: event.failureSummary,
  }
}

function toAgent(
  agent: Agent,
  extra: { connection: EmailConnection; members: number; next: EventWithDeliveries | null; last: EventWithDeliveries | null },
) {
  const type = getAgentType(agent.typeKey)
  const spec = teamSpec(agent.typeKey)
  const rules = teamRules(agent)
  return {
    id: agent.id,
    typeKey: agent.typeKey,
    typeName: type?.name ?? agent.typeKey,
    family: agent.family,
    name: agent.name,
    status: agent.status,
    destinations: teamDelivery(agent).destinations ?? [],
    schedule: rules.schedule ?? null,
    include: rules.include ?? [],
    sections: spec?.sections.map((s) => ({ key: s.key, label: s.label })) ?? [],
    templateKey: agent.templateKey,
    themeKey: agent.themeKey,
    sender: toEmailConnection(extra.connection),
    recipientCount: extra.members,
    nextEvent: extra.next ? toEventSummary(extra.next, agent, extra.members) : null,
    lastEvent: extra.last ? toEventSummary(extra.last, agent, extra.members) : null,
    problems: type ? type.validate(configOf(agent)) : ['This kind of agent is no longer available'],
    publishedAt: agent.publishedAt,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  }
}

async function hydrate(agents: Agent[], workspaceId: string) {
  if (!agents.length) return []
  const ids = agents.map((a) => a.id)
  const [members, upcoming, finished] = await Promise.all([
    memberCount(workspaceId),
    db.agentEvent.findMany({ where: { agentId: { in: ids }, status: { in: ['scheduled', 'running'] } }, orderBy: { scheduledFor: 'asc' }, include: { deliveries: true } }),
    db.agentEvent.findMany({
      where: { agentId: { in: ids }, status: { in: ['completed', 'failed', 'canceled'] } },
      orderBy: { scheduledFor: 'desc' },
      include: { deliveries: true },
      take: ids.length * 3,
    }),
  ])
  const connections = new Map<string, EmailConnection>()
  const result = []
  for (const agent of agents) {
    const key = agent.emailConnectionId ?? 'default'
    if (!connections.has(key)) connections.set(key, await agentConnection(agent))
    result.push(
      toAgent(agent, {
        connection: connections.get(key)!,
        members,
        next: upcoming.find((e) => e.agentId === agent.id) ?? null,
        last: finished.find((e) => e.agentId === agent.id) ?? null,
      }),
    )
  }
  return result
}

// ─── service ───────────────────────────────────────────────────────────────────

export class AgentService {
  async types(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'agent.read')
    return listAgentTypes()
      .filter((t) => t.enabled)
      .map((t) => ({ key: t.key, family: t.family, name: t.name, description: t.description }))
  }

  async list(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'agent.read')
    const agents = await db.agent.findMany({ where: { workspaceId, status: { not: 'archived' } }, orderBy: [{ updatedAt: 'desc' }] })
    const rank: Record<string, number> = { active: 0, paused: 1, draft: 2 }
    return (await hydrate(agents, workspaceId)).sort((a, b) => rank[a.status]! - rank[b.status]!)
  }

  async get(userId: string, workspaceId: string, agentId: string) {
    await authorize(userId, workspaceId, 'agent.read')
    return (await hydrate([await loadAgent(workspaceId, agentId)], workspaceId))[0]!
  }

  /** Adding a built-in creates a draft straight away (no wizard; docs/agents/01 §2). */
  async create(ctx: WorkspaceCtx, workspaceId: string, input: { typeKey: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'agent.manage')
    const type = getAgentType(input.typeKey)
    if (!type?.enabled) throw badRequest('Choose one of the available agents', 'UNKNOWN_AGENT_TYPE')
    const d = type.defaults(actor.workspace)
    const agent = await runAction(
      { action: 'agent.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'agent' } },
      async (tx) => {
        const created = await tx.agent.create({
          data: {
            workspaceId,
            typeKey: type.key,
            family: type.family,
            name: d.name,
            recipientConfig: d.recipientConfig as Prisma.InputJsonValue,
            deliveryConfig: d.deliveryConfig as Prisma.InputJsonValue,
            ruleConfig: d.ruleConfig as Prisma.InputJsonValue,
            templateKey: d.templateKey,
            themeKey: d.themeKey,
            createdByMemberId: actor.member.id,
          },
        })
        return { value: created, targetId: created.id }
      },
    )
    return (await hydrate([agent], workspaceId))[0]!
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, agentId: string, input: UpdateAgentInput) {
    const actor = await authorize(ctx.user.id, workspaceId, 'agent.manage')
    const before = await loadAgent(workspaceId, agentId)
    if (before.status === 'archived') throw conflict('This agent is archived', 'AGENT_ARCHIVED')
    const type = typeOf(before)
    const name = input.name?.trim()
    if (input.name !== undefined && !name) throw badRequest('Give the agent a name', 'INVALID_NAME')
    if (input.templateKey !== undefined && !isEmailTemplateKey(input.templateKey)) throw badRequest('Unknown template', 'INVALID_TEMPLATE')
    if (input.themeKey !== undefined && !isEmailThemeKey(input.themeKey)) throw badRequest('Unknown theme', 'INVALID_THEME')

    const delivery = { ...teamDelivery(before), ...(input.destinations ? { destinations: input.destinations } : {}) }
    const rules = { ...teamRules(before), ...(input.schedule ? { schedule: input.schedule as TeamRules['schedule'] } : {}), ...(input.include ? { include: input.include } : {}) }
    const problems = type.validate({ recipientConfig: before.recipientConfig, deliveryConfig: delivery as unknown as Prisma.JsonValue, ruleConfig: rules as unknown as Prisma.JsonValue })
    if (problems.length) throw badRequest(problems[0]!, 'INVALID_AGENT')

    const after = await runAction(
      { action: 'agent.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { agentId, ...input }, target: { type: 'agent', id: agentId } },
      async (tx) => {
        const updated = await tx.agent.update({
          where: { id: agentId },
          data: {
            name,
            templateKey: input.templateKey as EmailTemplateKey | undefined,
            themeKey: input.themeKey as EmailThemeKey | undefined,
            deliveryConfig: delivery as unknown as Prisma.InputJsonValue,
            ruleConfig: rules as unknown as Prisma.InputJsonValue,
          },
        })
        const changes: Changes = {}
        for (const field of ['name', 'templateKey', 'themeKey'] as const) if (before[field] !== updated[field]) changes[field] = [before[field], updated[field]]
        for (const field of ['deliveryConfig', 'ruleConfig'] as const)
          if (JSON.stringify(before[field]) !== JSON.stringify(updated[field])) changes[field] = [before[field], updated[field]]
        return { value: updated, changes }
      },
    )
    // Edits affect future events only; the upcoming one follows a schedule change.
    if (after.status === 'active') await scheduleNext(agentId, new Date())
    return (await hydrate([after], workspaceId))[0]!
  }

  async publish(ctx: WorkspaceCtx, workspaceId: string, agentId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'agent.manage')
    const agent = await loadAgent(workspaceId, agentId)
    if (agent.status === 'archived') throw conflict('This agent is archived', 'AGENT_ARCHIVED')
    const problems = typeOf(agent).validate(configOf(agent))
    if (problems.length) throw badRequest(problems[0]!, 'INVALID_AGENT')
    return this.setStatus(ctx, actor, agent, 'active', 'agent.publish')
  }

  async pause(ctx: WorkspaceCtx, workspaceId: string, agentId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'agent.manage')
    const agent = await loadAgent(workspaceId, agentId)
    if (agent.status !== 'active') throw conflict('Only an active agent can be paused', 'AGENT_NOT_ACTIVE')
    return this.setStatus(ctx, actor, agent, 'paused', 'agent.pause')
  }

  /** A draft with no history is deleted; anything with history is archived (docs/agents/02). */
  async remove(ctx: WorkspaceCtx, workspaceId: string, agentId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'agent.manage')
    const agent = await loadAgent(workspaceId, agentId)
    const history = await db.agentEvent.count({ where: { agentId, NOT: { status: 'scheduled', preparedAt: null } } })
    if (!history) {
      await runAction(
        { action: 'agent.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { agentId }, target: { type: 'agent', id: agentId } },
        async (tx) => {
          await tx.agent.delete({ where: { id: agentId } })
          return { value: null, changes: { name: [agent.name, null] } }
        },
      )
      return { result: 'deleted' as const }
    }
    await this.setStatus(ctx, actor, agent, 'archived', 'agent.archive')
    return { result: 'archived' as const }
  }

  private async setStatus(ctx: WorkspaceCtx, actor: Actor, agent: Agent, status: 'active' | 'paused' | 'archived', action: string) {
    const after = await runAction(
      { action, workspaceId: agent.workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { agentId: agent.id }, target: { type: 'agent', id: agent.id } },
      async (tx) => {
        const updated = await tx.agent.update({
          where: { id: agent.id },
          data: { status, ...(status === 'active' && !agent.publishedAt ? { publishedAt: new Date() } : {}) },
        })
        const changes: Changes = agent.status !== status ? { status: [agent.status, status] } : {}
        return { value: updated, changes }
      },
    )
    await scheduleNext(agent.id, new Date())
    return (await hydrate([after], agent.workspaceId))[0]!
  }

  /** The report as it would go out now, rendered for the caller. No side effects. */
  async preview(userId: string, workspaceId: string, agentId: string) {
    const actor = await authorize(userId, workspaceId, 'agent.read')
    const agent = await loadAgent(workspaceId, agentId)
    return this.render(actor, agent, false)
  }

  /** Emails the current report to the caller only (marked as a test). No event, no chat post. */
  async sendTest(ctx: WorkspaceCtx, workspaceId: string, agentId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'agent.manage')
    const agent = await loadAgent(workspaceId, agentId)
    const to = ctx.user.email as string | null
    if (!to) throw badRequest('Your account has no email address to send the test to', 'NO_TEST_ADDRESS')
    const rendered = await this.render(actor, agent, true)
    const connection = await agentConnection(agent)
    const result = await providerFor(connection).send(connection, { to, subject: rendered.subject, html: rendered.html, text: rendered.text })
    const value = {
      ok: result.ok,
      sentTo: result.ok ? to : null,
      providerMessageId: result.ok ? result.providerMessageId : null,
      error: result.ok ? null : { code: result.code, message: result.message },
    }
    return runAction(
      { action: 'agent.test', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { agentId, to }, target: { type: 'agent', id: agentId } },
      async () => ({ value, result: { ok: value.ok, code: value.error?.code ?? null, providerMessageId: value.providerMessageId } }),
    )
  }

  private async render(actor: Actor, agent: Agent, test: boolean) {
    const spec = teamSpec(agent.typeKey)
    if (!spec) throw badRequest('This kind of agent is no longer available', 'UNKNOWN_AGENT_TYPE')
    const report = await buildReport(spec, actor.workspace, teamRules(agent).include ?? [], new Date())
    const profile = await db.profile.findUnique({ where: { userId: actor.member.userId }, select: { displayName: true } })
    const name = profile?.displayName?.trim() || 'there'
    const values = { ...(await baseValues(actor.workspace)), 'member.displayName': name, 'member.firstName': name.split(/\s+/)[0] }
    const email = renderEmail({
      subject: report.subject,
      content: report.content,
      template: agent.templateKey as EmailTemplateKey,
      theme: agent.themeKey as EmailThemeKey,
      values,
      footer: teamFooter(spec),
      test,
    })
    return {
      ...email,
      chat: report.chat.text,
      sections: report.sections.map((s) => ({ key: s.key, title: s.title, count: s.count })),
      recipientCount: await memberCount(agent.workspaceId),
    }
  }

  // ─── activity river ──────────────────────────────────────────────────────────

  /** Upcoming and past events, newest scheduled time first (future at the top). */
  async events(userId: string, workspaceId: string, opts: { agentId?: string; cursor?: string; limit?: number }) {
    await authorize(userId, workspaceId, 'agent.read')
    const limit = normalizeLimit(opts.limit, 100, 30)
    const cursor = decodeKeyCursor<{ at: string; id: string }>(opts.cursor)
    const rows = await db.agentEvent.findMany({
      where: {
        workspaceId,
        ...(opts.agentId ? { agentId: opts.agentId } : {}),
        ...(cursor ? { OR: [{ scheduledFor: { lt: new Date(cursor.at) } }, { scheduledFor: new Date(cursor.at), id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { deliveries: true, agent: { select: { id: true, name: true, typeKey: true, deliveryConfig: true } } },
    })
    const members = await memberCount(workspaceId)
    const paged = page(rows, limit, (last) => encodeKeyCursor({ at: last.scheduledFor.toISOString(), id: last.id }))
    return { data: paged.data.map((e) => toEventSummary(e, e.agent, members)), meta: paged.meta }
  }

  async event(userId: string, workspaceId: string, eventId: string) {
    await authorize(userId, workspaceId, 'agent.read')
    const event = await db.agentEvent.findFirst({
      where: { id: eventId, workspaceId },
      include: {
        agent: { select: { id: true, name: true, typeKey: true, deliveryConfig: true } },
        deliveries: { include: { targets: { orderBy: { createdAt: 'asc' }, include: { sendAttempts: { orderBy: { number: 'asc' } } } } } },
      },
    })
    if (!event) throw notFound()
    const members = await memberCount(workspaceId)
    const email = event.deliveries.find((d) => d.destination === 'email')
    const chat = event.deliveries.find((d) => d.destination === 'internal_chat')
    const sample = email?.targets.find((t) => t.html || t.text)
    const issues = event.deliveries.flatMap((d) =>
      d.targets
        .filter((t) => t.status !== 'sent' || t.attempts > 1)
        .map((t) => ({
          destination: d.destination,
          address: t.address,
          status: t.status,
          failureCode: t.failureCode,
          failureMessage: t.failureMessage,
          attempts: t.sendAttempts.map((a) => ({ number: a.number, outcome: a.outcome, code: a.code, message: a.message, at: a.at })),
        })),
    )
    return {
      ...toEventSummary(event, event.agent, members),
      sender: (email?.sender as Record<string, unknown> | null) ?? null,
      preview: { subject: sample?.subject ?? null, html: sample?.html ?? null, text: sample?.text ?? null, chat: chat?.targets[0]?.text ?? null },
      issues,
    }
  }

  /** Cancels an upcoming or running event; the schedule moves on to the next occurrence. */
  async cancelEvent(ctx: WorkspaceCtx, workspaceId: string, eventId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'agent.manage')
    const event = await db.agentEvent.findFirst({ where: { id: eventId, workspaceId } })
    if (!event) throw notFound()
    if (event.status !== 'scheduled' && event.status !== 'running') throw conflict('This event already finished', 'EVENT_FINISHED')
    await runAction(
      { action: 'agentEvent.cancel', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { eventId }, target: { type: 'agentEvent', id: eventId } },
      async (tx) => {
        const now = new Date()
        const done = await tx.agentEvent.updateMany({
          where: { id: eventId, status: { in: ['scheduled', 'running'] } },
          data: { status: 'canceled', completedAt: now, leaseUntil: null, failureSummary: 'Canceled by a person.' },
        })
        if (done.count !== 1) throw conflict('This event already finished', 'EVENT_FINISHED')
        await tx.agentEventTarget.updateMany({
          where: { delivery: { eventId }, status: 'pending' },
          data: { status: 'skipped', dedupeSlot: null, nextAttemptAt: null, failureCode: 'CANCELED', failureMessage: 'Canceled before it was sent.' },
        })
        await tx.agentEventDelivery.updateMany({ where: { eventId, status: 'running' }, data: { status: 'completed', completedAt: now } })
        return { value: null, changes: { status: [event.status, 'canceled'] } }
      },
    )
    await scheduleNext(event.agentId, event.scheduledFor > new Date() ? event.scheduledFor : new Date())
    return this.event(ctx.user.id, workspaceId, eventId)
  }
}
