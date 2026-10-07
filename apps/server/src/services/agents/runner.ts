// The Agents job runner (docs/agents/07 S0). One in-process tick, single instance:
//   claim due events → prepare once (resolve recipients, dedupe, render, freeze) →
//   send pending targets → finalize, then schedule the Agent's next occurrence.
// Retries (decision 7): transient provider errors only, fixed delay, MAX_ATTEMPTS,
// every attempt recorded. Permanent and auth errors fail at once; auth fails the
// rest of that delivery too. While an event waits for a retry it stays `running`
// with `leaseUntil` = when to look again.
import { db, Prisma, type Agent, type AgentEvent, type EmailConnection } from '@project/db'
import { postSays } from '../../bots/flows/post'
import type { MessageLink } from '../../lib/choice'
import { ACTIVITY, recordActivityEvent } from '../activityEvent'
import { HOST_HANDLE, workspaceHost } from '../WorkspaceHost'
import { isEmailAddress, providerFor, type SendResult } from './email'
import { agentConnection } from './connections'
import { renderEmail } from './presentation'
import { getAgentType, type PreparedChat, type PreparedEmail } from './registry'
import './types'

export const MAX_ATTEMPTS = 3
export const RETRY_DELAY_MS = 2 * 60_000
const LEASE_MS = 2 * 60_000
const CLAIM_BATCH = 20
const SEND_BATCH = 50

type Tx = Prisma.TransactionClient

const due = (now: Date): Prisma.AgentEventWhereInput => ({
  OR: [
    { status: 'scheduled', scheduledFor: { lte: now } },
    { status: 'running', OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
  ],
})

/** One pass over due work. Returns the events it handled. */
export async function tick(now = new Date()): Promise<string[]> {
  const candidates = await db.agentEvent.findMany({ where: due(now), orderBy: { scheduledFor: 'asc' }, take: CLAIM_BATCH, select: { id: true } })
  const handled: string[] = []
  for (const { id } of candidates) {
    const claimed = await db.agentEvent.updateMany({ where: { id, ...due(now) }, data: { status: 'running', leaseUntil: new Date(now.getTime() + LEASE_MS) } })
    if (claimed.count !== 1) continue
    handled.push(id)
    try {
      await runEvent(id, now)
    } catch (err) {
      // A bug, not a delivery failure: fail the event loudly rather than loop on it.
      await failEvent(id, now, 'INTERNAL_ERROR', `Something went wrong running this event: ${(err as Error).message}`.slice(0, 500))
    }
  }
  return handled
}

async function runEvent(eventId: string, now: Date) {
  let event = await db.agentEvent.findUniqueOrThrow({ where: { id: eventId }, include: { agent: true } })
  if (!event.startedAt) event = { ...(await db.agentEvent.update({ where: { id: eventId }, data: { startedAt: now } })), agent: event.agent }

  if (!event.preparedAt) {
    if (event.agent.status !== 'active') return cancelEvent(event, now, `The agent is ${event.agent.status}.`)
    const outcome = await prepare(event, event.agent, now)
    if (outcome) return failEvent(eventId, now, outcome.code, outcome.summary)
  }
  await sendPending(eventId, now)
  await sendChat(eventId, now)
  await finalize(eventId, now)
}

// ─── prepare: resolve → dedupe → render → freeze ───────────────────────────────

async function prepare(event: AgentEvent, agent: Agent, now: Date): Promise<{ code: string; summary: string } | null> {
  const type = getAgentType(agent.typeKey)
  if (!type) return { code: 'UNKNOWN_TYPE', summary: 'This kind of agent is no longer available.' }
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: agent.workspaceId } })
  const prepared = await type.prepare({ agent, event, workspace, now })
  if (!prepared.ok) return { code: prepared.code, summary: prepared.summary }

  const connection = prepared.email ? await agentConnection(agent) : null
  await db.$transaction(async (tx) => {
    if (prepared.email && connection) await freezeEmail(tx, event, agent, connection, prepared.email)
    if (prepared.chat) await freezeChat(tx, event, agent, prepared.chat)
    await tx.agentEvent.update({ where: { id: event.id }, data: { preparedAt: now, messageId: prepared.messageId ?? event.messageId } })
    if (prepared.messageId) await tx.agentMessage.updateMany({ where: { id: prepared.messageId, agentId: agent.id, usedAt: null }, data: { usedAt: now } })
  })
  return null
}

async function freezeEmail(tx: Tx, event: AgentEvent, agent: Agent, connection: EmailConnection, email: PreparedEmail) {
  const sender = { connectionId: connection.id, strategy: connection.strategy, displayName: connection.displayName, replyTo: connection.replyTo }
  const blocked = connection.status !== 'active'
  const delivery = await tx.agentEventDelivery.create({
    data: {
      workspaceId: agent.workspaceId,
      eventId: event.id,
      destination: 'email',
      status: 'running',
      sender,
      startedAt: new Date(),
      failureSummary: blocked ? 'The sender needs attention. Check it in Email settings.' : null,
    },
  })

  // Duplicate suppression: a live (pending/sent) target with the same slot exists → SKIPPED.
  const slotOf = (key: string | null | undefined) => (key ? `${agent.id}:${key}`.slice(0, 191) : null)
  const slots = email.recipients.map((r) => slotOf(r.dedupeKey)).filter((s): s is string => !!s)
  const taken = new Set(
    slots.length ? (await tx.agentEventTarget.findMany({ where: { dedupeSlot: { in: slots } }, select: { dedupeSlot: true } })).map((t) => t.dedupeSlot) : [],
  )

  const rows: Prisma.AgentEventTargetCreateManyInput[] = []
  for (const r of email.recipients) {
    const address = r.address?.trim() ?? ''
    const slot = slotOf(r.dedupeKey)
    const base = { workspaceId: agent.workspaceId, deliveryId: delivery.id, agentId: agent.id, contactId: r.contactId ?? null, memberId: r.memberId ?? null, address: address.slice(0, 255), dedupeKey: r.dedupeKey ?? null }
    if (slot && taken.has(slot)) {
      rows.push({ ...base, status: 'skipped', subject: '', html: '', text: '', failureCode: 'DUPLICATE', failureMessage: `Already sent to ${r.label}.` })
      continue
    }
    if (!isEmailAddress(address)) {
      rows.push({ ...base, status: 'failed', subject: '', html: '', text: '', failureCode: 'MISSING_EMAIL', failureMessage: `${r.label} has no valid email address.` })
      continue
    }
    if (slot) taken.add(slot)
    const rendered = renderEmail({ subject: email.subject, content: email.content, template: email.template, theme: email.theme, values: r.values, footer: email.footer })
    rows.push(
      blocked
        ? { ...base, status: 'failed', subject: rendered.subject.slice(0, 255), html: rendered.html, text: rendered.text, failureCode: 'SENDER_NEEDS_ATTENTION', failureMessage: 'The sender needs attention.' }
        : { ...base, status: 'pending', dedupeSlot: slot, subject: rendered.subject.slice(0, 255), html: rendered.html, text: rendered.text },
    )
  }
  if (rows.length) await tx.agentEventTarget.createMany({ data: rows })
}

/** Company chat: one target, the workspace channel; the post is frozen like an email. */
async function freezeChat(tx: Tx, event: AgentEvent, agent: Agent, chat: PreparedChat) {
  const delivery = await tx.agentEventDelivery.create({
    data: { workspaceId: agent.workspaceId, eventId: event.id, destination: 'internal_chat', status: 'running', startedAt: new Date() },
  })
  await tx.agentEventTarget.create({
    data: {
      workspaceId: agent.workspaceId,
      deliveryId: delivery.id,
      agentId: agent.id,
      address: 'company-chat',
      dedupeSlot: `${agent.id}:chat:${event.occurrenceKey}`.slice(0, 191),
      dedupeKey: `chat:${event.occurrenceKey}`,
      subject: chat.text.split(/[.\n]/)[0]!.slice(0, 255),
      html: '',
      text: chat.text,
      payload: { links: chat.links } as unknown as Prisma.InputJsonValue,
    },
  })
}

// ─── send ──────────────────────────────────────────────────────────────────────

/** Posts a frozen chat target as the workspace host. Not retried: a refusal is final. */
async function sendChat(eventId: string, now: Date) {
  const targets = await db.agentEventTarget.findMany({ where: { delivery: { eventId, destination: 'internal_chat', status: 'running' }, status: 'pending' } })
  for (const target of targets) {
    let result: SendResult
    try {
      const channel = await workspaceHost.ensureChannel(target.workspaceId)
      const bot = await db.bot.findUnique({ where: { handle: HOST_HANDLE }, select: { userId: true, enabled: true } })
      const links = ((target.payload as { links?: MessageLink[] } | null)?.links ?? []) as MessageLink[]
      const posted = bot?.enabled ? await postSays(bot.userId, channel.roomId, true, ACTIVITY, [{ text: target.text, links: links.length ? links : undefined }]) : []
      result = posted[0]
        ? { ok: true, providerMessageId: `item:${posted[0]}` }
        : { ok: false, kind: 'permanent', code: 'CHAT_UNAVAILABLE', message: 'Company chat did not accept the post (the workspace host is off on this server).' }
    } catch (err) {
      result = { ok: false, kind: 'permanent', code: 'CHAT_FAILED', message: (err as Error).message.slice(0, 300) }
    }
    await recordAttempt(target.id, target.attempts + 1, result, now)
  }
}

async function sendPending(eventId: string, now: Date) {
  const deliveries = await db.agentEventDelivery.findMany({ where: { eventId, destination: 'email', status: 'running' } })
  for (const delivery of deliveries) {
    const sender = delivery.sender as { connectionId: string } | null
    const connection = sender ? await db.emailConnection.findUnique({ where: { id: sender.connectionId } }) : null
    for (;;) {
      const event = await db.agentEvent.findUniqueOrThrow({ where: { id: eventId }, select: { status: true } })
      if (event.status === 'canceled') return
      const batch = await db.agentEventTarget.findMany({
        where: { deliveryId: delivery.id, status: 'pending', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        orderBy: { createdAt: 'asc' },
        take: SEND_BATCH,
      })
      if (!batch.length) break
      await db.agentEvent.update({ where: { id: eventId }, data: { leaseUntil: new Date(now.getTime() + LEASE_MS) } })
      for (const target of batch) {
        const result: SendResult = !connection
          ? { ok: false, kind: 'auth', code: 'SENDER_MISSING', message: 'The sender was removed.' }
          : await providerFor(connection)
              .send(connection, { to: target.address, subject: target.subject, html: target.html, text: target.text, idempotencyKey: `agent-target:${target.id}` })
              .catch((err: Error): SendResult => ({ ok: false, kind: 'transient', code: 'PROVIDER_ERROR', message: err.message.slice(0, 300) }))
        await recordAttempt(target.id, target.attempts + 1, result, now)
        if (!result.ok && result.kind === 'auth') {
          await failRemaining(delivery.id, result.code, result.message)
          if (connection && connection.strategy !== 'platform') {
            await db.emailConnection.update({ where: { id: connection.id }, data: { status: 'needs_attention', lastError: result.message.slice(0, 500) } })
          }
          await db.agentEventDelivery.update({ where: { id: delivery.id }, data: { failureSummary: `Sending stopped: ${result.message}`.slice(0, 500) } })
          break
        }
      }
    }
  }
}

async function recordAttempt(targetId: string, number: number, result: SendResult, now: Date) {
  const outcome = result.ok ? 'sent' : result.kind
  const retry = !result.ok && result.kind === 'transient' && number < MAX_ATTEMPTS
  await db.$transaction([
    db.agentSendAttempt.create({
      data: {
        targetId,
        number,
        outcome,
        code: result.ok ? null : result.code,
        message: result.ok ? null : result.message.slice(0, 500),
        providerMessageId: result.ok ? result.providerMessageId.slice(0, 255) : null,
        at: new Date(),
      },
    }),
    db.agentEventTarget.update({
      where: { id: targetId },
      data: result.ok
        ? { status: 'sent', attempts: number, sentAt: new Date(), providerMessageId: result.providerMessageId.slice(0, 255), nextAttemptAt: null, failureCode: null, failureMessage: null }
        : retry
          ? { attempts: number, nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS), failureCode: result.code, failureMessage: result.message.slice(0, 500) }
          : { status: 'failed', attempts: number, nextAttemptAt: null, dedupeSlot: null, failureCode: result.code, failureMessage: result.message.slice(0, 500) },
    }),
  ])
}

async function failRemaining(deliveryId: string, code: string, message: string) {
  await db.agentEventTarget.updateMany({
    where: { deliveryId, status: 'pending' },
    data: { status: 'failed', dedupeSlot: null, nextAttemptAt: null, failureCode: code, failureMessage: message.slice(0, 500) },
  })
}

// ─── finalize ──────────────────────────────────────────────────────────────────

async function finalize(eventId: string, now: Date) {
  const event = await db.agentEvent.findUniqueOrThrow({ where: { id: eventId }, include: { agent: true } })
  if (event.status !== 'running') return
  const waiting = await db.agentEventTarget.findFirst({
    where: { delivery: { eventId }, status: 'pending' },
    orderBy: { nextAttemptAt: 'asc' },
    select: { nextAttemptAt: true },
  })
  if (waiting) {
    await db.agentEvent.update({ where: { id: eventId }, data: { leaseUntil: waiting.nextAttemptAt ?? now } })
    return
  }

  const deliveries = await db.agentEventDelivery.findMany({ where: { eventId } })
  let total = { targets: 0, sent: 0, failed: 0, skipped: 0 }
  const reasons = new Map<string, { message: string; count: number }>()
  for (const d of deliveries) {
    const counts = await db.agentEventTarget.groupBy({ by: ['status'], where: { deliveryId: d.id }, _count: true })
    const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0
    const c = { targets: counts.reduce((a, x) => a + x._count, 0), sent: n('sent'), failed: n('failed'), skipped: n('skipped') }
    total = { targets: total.targets + c.targets, sent: total.sent + c.sent, failed: total.failed + c.failed, skipped: total.skipped + c.skipped }
    for (const f of await db.agentEventTarget.groupBy({ by: ['failureCode', 'failureMessage'], where: { deliveryId: d.id, status: 'failed' }, _count: true })) {
      const key = f.failureCode ?? 'FAILED'
      const prev = reasons.get(key)
      reasons.set(key, { message: prev?.message ?? f.failureMessage ?? 'Failed', count: (prev?.count ?? 0) + f._count })
    }
    await db.agentEventDelivery.update({
      where: { id: d.id },
      data: {
        status: c.sent === 0 && c.failed > 0 ? 'failed' : 'completed',
        targetCount: c.targets,
        successCount: c.sent,
        failureCount: c.failed,
        skippedCount: c.skipped,
        completedAt: now,
      },
    })
  }

  const nobody = total.targets === 0
  const failed = nobody || (total.sent === 0 && total.failed > 0)
  const top = [...reasons.entries()].sort((a, b) => b[1].count - a[1].count)[0]
  const summary = nobody ? 'There was nobody to send to.' : total.failed ? `${total.failed} failed — ${top?.[1].message ?? 'see details'}` : null
  await db.agentEvent.update({
    where: { id: eventId },
    data: {
      status: failed ? 'failed' : 'completed',
      completedAt: now,
      leaseUntil: null,
      targetCount: total.targets,
      successCount: total.sent,
      failureCount: total.failed,
      skippedCount: total.skipped,
      failureCode: nobody ? 'NO_RECIPIENTS' : total.failed ? (top?.[0] ?? 'FAILED') : null,
      failureSummary: summary?.slice(0, 500) ?? null,
    },
  })
  if (summary) await announceFailure(event.agent, eventId, summary)
  await scheduleNext(event.agent.id, now)
}

async function failEvent(eventId: string, now: Date, code: string, summary: string) {
  const event = await db.agentEvent.update({
    where: { id: eventId },
    data: { status: 'failed', completedAt: now, leaseUntil: null, failureCode: code.slice(0, 64), failureSummary: summary.slice(0, 500) },
    include: { agent: true },
  })
  await announceFailure(event.agent, eventId, summary)
  await scheduleNext(event.agentId, now)
}

async function cancelEvent(event: AgentEvent, now: Date, summary: string) {
  await db.agentEvent.update({ where: { id: event.id }, data: { status: 'canceled', completedAt: now, leaseUntil: null, failureSummary: summary.slice(0, 500) } })
}

/** Failures are loud (docs/agents/04): one workspace attention event per failed event. */
async function announceFailure(agent: Agent, eventId: string, summary: string) {
  try {
    await recordActivityEvent({
      workspaceId: agent.workspaceId,
      type: 'agent.failed',
      title: `${agent.name} needs attention`,
      summary,
      sourceType: 'agentEvent',
      sourceId: eventId,
      dedupeKey: `agent-event:${eventId}:failed`,
    })
  } catch (err) {
    console.error('agents: could not announce failure', err)
  }
}

// ─── schedule ──────────────────────────────────────────────────────────────────

/**
 * Keeps exactly one upcoming event for an active scheduled Agent: the next
 * occurrence after `after`. Unprepared scheduled events for other occurrences are
 * removed (an edit moved the schedule). Called on publish/edit/resume and after
 * each event ends. Never backfills missed occurrences.
 */
export async function scheduleNext(agentId: string, after: Date) {
  const agent = await db.agent.findUnique({ where: { id: agentId }, include: { workspace: { select: { timezone: true } } } })
  const type = agent && getAgentType(agent.typeKey)
  const next = agent?.status === 'active' && type?.schedule ? type.schedule(agent, after, agent.workspace.timezone) : null
  await db.agentEvent.deleteMany({
    where: { agentId, status: 'scheduled', preparedAt: null, ...(next ? { NOT: { occurrenceKey: next.key } } : {}) },
  })
  if (!agent || !next) return null
  try {
    return await db.agentEvent.upsert({
      where: { agentId_occurrenceKey: { agentId, occurrenceKey: next.key } },
      create: { workspaceId: agent.workspaceId, agentId, scheduledFor: next.at, occurrenceKey: next.key },
      update: {},
    })
  } catch (err) {
    if ((err as Prisma.PrismaClientKnownRequestError).code !== 'P2002') throw err
    return db.agentEvent.findUnique({ where: { agentId_occurrenceKey: { agentId, occurrenceKey: next.key } } })
  }
}

// ─── process loop ──────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null

/** Starts the in-process tick (single instance). AGENTS_SCHEDULER=off disables it. */
export function startAgentRunner(intervalMs = 30_000) {
  if (process.env.AGENTS_SCHEDULER === 'off' || timer) return false
  let busy = false
  timer = setInterval(() => {
    if (busy) return
    busy = true
    tick()
      .catch((err) => console.error('agents: tick failed', err))
      .finally(() => {
        busy = false
      })
  }, intervalMs)
  timer.unref()
  return true
}

export function stopAgentRunner() {
  if (timer) clearInterval(timer)
  timer = null
}
