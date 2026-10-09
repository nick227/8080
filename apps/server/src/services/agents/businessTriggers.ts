import { db, Prisma, type Agent, type AgentEvent } from '@project/db'
import { canonicalJson } from '../../lib/canonical'
import { badRequest, conflict } from '../../lib/errors'

export const BUSINESS_KINDS = ['became_customer', 'stage_changed', 'outreach_sent', 'reply_received', 'job_completed'] as const
export type BusinessKind = typeof BUSINESS_KINDS[number]
export type TriggerRules = { delayDays: number; noReplyDays: number; stages?: string[] }
export function triggerRules(config: unknown): TriggerRules {
  const value = (config as { trigger?: unknown } | null)?.trigger ?? {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Invalid trigger rules', 'INVALID_TRIGGER')
  const r = value as TriggerRules
  if (Object.keys(r).some(k => !['delayDays', 'noReplyDays', 'stages'].includes(k))) throw badRequest('Unknown trigger rule', 'INVALID_TRIGGER')
  const delayDays = r.delayDays ?? 0
  const noReplyDays = r.noReplyDays ?? 7
  if (!Number.isInteger(delayDays) || delayDays < 0 || delayDays > 365 || !Number.isInteger(noReplyDays) || noReplyDays < 1 || noReplyDays > 365) throw badRequest('Choose a delay of 0–365 days and a no-reply threshold of 1–365 days', 'INVALID_TRIGGER')
  if (r.stages !== undefined && (!Array.isArray(r.stages) || !r.stages.length || r.stages.some(s => typeof s !== 'string' || !s || s.length > 64))) throw badRequest('Choose valid destination stages', 'INVALID_TRIGGER')
  return { delayDays, noReplyDays, ...(r.stages ? { stages: r.stages } : {}) }
}
const typesFor: Record<BusinessKind, string[]> = {
  became_customer: ['welcome_new_customer'], stage_changed: ['followup_status_change'], outreach_sent: ['checkin_no_reply'], reply_received: [], job_completed: ['ask_for_review', 'checkin_after_service'],
}
export type BusinessInput = { contactId: string; kind: BusinessKind; sourceKey: string; occurredAt: Date; facts?: Record<string, string> }

/** Atomic with the source mutation; unique source + Agent occurrence keys make replay harmless. */
export async function produceBusinessEvent(tx: Prisma.TransactionClient, workspaceId: string, input: BusinessInput) {
  if (!BUSINESS_KINDS.includes(input.kind) || !input.sourceKey || input.sourceKey.length > 160 || !Number.isFinite(input.occurredAt.getTime())) throw badRequest('Invalid business event', 'INVALID_BUSINESS_EVENT')
  const contact = await tx.contact.findFirst({ where: { id: input.contactId, workspaceId, deletedAt: null, mergedIntoId: null, status: 'active' } })
  if (!contact) throw badRequest('Choose an active contact in this workspace', 'INVALID_CONTACT')
  const existing = await tx.agentBusinessEvent.findUnique({ where: { workspaceId_sourceKey: { workspaceId, sourceKey: input.sourceKey } } })
  if (existing) {
    if (existing.contactId !== input.contactId || existing.kind !== input.kind || existing.occurredAt.getTime() !== input.occurredAt.getTime() || canonicalJson(existing.facts) !== canonicalJson(input.facts ?? {})) throw conflict('This business event key is already in use', 'BUSINESS_EVENT_KEY_REUSED')
    return existing
  }
  const signal = await tx.agentBusinessEvent.create({ data: { workspaceId, ...input, facts: input.facts ?? {} } })
  const agents = await tx.agent.findMany({ where: { workspaceId, status: 'active', typeKey: { in: typesFor[input.kind] } } })
  for (const agent of agents) {
    // Publishing never backfills historic events. A manually recorded old job is still historical.
    if (!agent.publishedAt || signal.occurredAt < agent.publishedAt) continue
    let rules: TriggerRules
    try { rules = triggerRules(agent.ruleConfig) } catch { continue } // malformed rules fail closed
    if (signal.kind === 'stage_changed' && rules.stages && !rules.stages.includes(input.facts?.to ?? '')) continue
    const days = signal.kind === 'outreach_sent' ? rules.noReplyDays : rules.delayDays
    await tx.agentEvent.createMany({ data: [{ workspaceId, agentId: agent.id, occurrenceKey: `business:${signal.id}`, scheduledFor: new Date(signal.occurredAt.getTime() + days * 86400000), context: { contactId: contact.id, businessEventId: signal.id, kind: signal.kind, triggerRules: rules } }], skipDuplicates: true })
  }
  return signal
}

/** Recheck delayed facts immediately before freezing. No inferred 'no reply' from general activity. */
export async function triggerStillApplies(agent: Agent, event: AgentEvent): Promise<string | null> {
  const ctx = event.context as { businessEventId?: string; contactId?: string; kind?: string } | null
  if (!ctx?.businessEventId) return null // explicit legacy/test trigger context
  const signal = await db.agentBusinessEvent.findFirst({ where: { id: ctx.businessEventId, workspaceId: agent.workspaceId, contactId: ctx.contactId } })
  if (!signal) return 'The business event is no longer available.'
  const contact = await db.contact.findFirst({ where: { id: signal.contactId, workspaceId: agent.workspaceId, status: 'active', deletedAt: null, mergedIntoId: null } })
  if (!contact) return 'The triggering contact is no longer active.'
  if (signal.kind === 'outreach_sent') {
    const newer = await db.agentBusinessEvent.findFirst({ where: { workspaceId: agent.workspaceId, contactId: signal.contactId, id: { not: signal.id }, kind: { in: ['outreach_sent', 'reply_received'] }, occurredAt: { gte: signal.occurredAt } } })
    if (newer) return 'A reply or newer outreach superseded this follow-up.'
    if (!contact.lastContactedAt || contact.lastContactedAt.getTime() !== signal.occurredAt.getTime()) return 'The original outreach was changed or retracted.'
  }
  if (signal.kind === 'stage_changed' && contact.leadStatus !== (signal.facts as { to?: string }).to) return 'The contact has since moved to another pipeline stage.'
  return null
}

type ContactState = { id: string; version: number; leadStatus: string; status: string; tags: { tag: { name: string } }[] }
/** Customer means entering a won stage or acquiring the Customer category. */
export async function contactTransitions(tx: Prisma.TransactionClient, workspaceId: string, before: ContactState | null, after: ContactState, at: Date) {
  if (after.status !== 'active') return
  const stages = await tx.pipelineStage.findMany({ where: { workspaceId, key: { in: [before?.leadStatus ?? '', after.leadStatus] } }, select: { key: true, kind: true } })
  const isCustomer = (c: ContactState | null) => !!c && (stages.some(s => s.key === c.leadStatus && s.kind === 'won') || c.tags.some(t => t.tag.name.toLowerCase() === 'customer'))
  const key = `contact:${after.id}:v${after.version}`
  if (!isCustomer(before) && isCustomer(after)) await produceBusinessEvent(tx, workspaceId, { contactId: after.id, kind: 'became_customer', sourceKey: `${key}:customer`, occurredAt: at })
  if (before && before.leadStatus !== after.leadStatus) await produceBusinessEvent(tx, workspaceId, { contactId: after.id, kind: 'stage_changed', sourceKey: `${key}:stage`, occurredAt: at, facts: { from: before.leadStatus, to: after.leadStatus } })
}
