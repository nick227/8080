// Team report sections (docs/agents/06). Deterministic queries over data the
// workspace owns; product-defined, never a query builder. Each section reads a
// window ending at `at` (the event's scheduled time), so a report is reproducible.
// AI is not involved.
import { db, type Prisma, type Workspace } from '@project/db'
import { isUrgent } from '@project/shared'
import type { MessageLink } from '../../lib/choice'
import { localDayBounds, localDayKey } from '../../lib/workspaceDay'
import { toAuthor } from '../../lib/serialize'
import { loadWorkflow } from '../TaskWorkflowService'

export type ReportSection = {
  key: string
  title: string
  /** How many things the section is about (lines may be capped). */
  count: number
  lines: string[]
  /** Chat links (existing link kinds only), e.g. the contacts behind a line. */
  links: MessageLink[]
}

export type SectionDef = { key: string; label: string; build: (ws: Workspace, at: Date) => Promise<ReportSection> }

const DAY_MS = 24 * 60 * 60_000
const LINE_CAP = 6
const LINK_CAP = 4
// Closed stages; every other stage (including workspace-defined ones) counts as open.
const CLOSED_STAGES = ['customer', 'lost']

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const more = (lines: string[], total: number) => (total > lines.length ? [...lines, `and ${total - lines.length} more`] : lines)

function localDate(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(at)
}

// ─── shared builders ───────────────────────────────────────────────────────────

/** Open contacts whose follow-up falls on or before the report's local day. */
async function followUpsDue(ws: Workspace, at: Date): Promise<ReportSection> {
  const { end } = localDayBounds(ws.timezone, at)
  const where = { workspaceId: ws.id, deletedAt: null, mergedIntoId: null, status: 'active' as const, nextFollowUp: { lt: end } }
  const [count, rows] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({ where, orderBy: { nextFollowUp: 'asc' }, take: LINE_CAP, select: { id: true, displayName: true, nextFollowUp: true } }),
  ])
  const { start } = localDayBounds(ws.timezone, at)
  return {
    key: 'followUpsDue',
    title: 'Follow-ups due',
    count,
    lines: more(rows.map((c) => `${c.displayName}${c.nextFollowUp && c.nextFollowUp < start ? ` · overdue since ${localDate(c.nextFollowUp, ws.timezone)}` : ''}`), count),
    links: rows.slice(0, LINK_CAP).map((c) => ({ type: 'contact', id: c.id, workspaceId: ws.id, title: c.displayName })),
  }
}

// ─── Daily Team Brief ──────────────────────────────────────────────────────────

async function importantActivity(ws: Workspace, at: Date): Promise<ReportSection> {
  const where = { workspaceId: ws.id, createdAt: { gte: new Date(at.getTime() - DAY_MS), lt: at }, NOT: { type: 'agent.failed' } }
  const [count, rows] = await Promise.all([
    db.activityEvent.count({ where }),
    db.activityEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: LINE_CAP, select: { title: true } }),
  ])
  return { key: 'activity', title: 'Important activity', count, lines: more(rows.map((r) => r.title), count), links: [] }
}

/**
 * Board tasks that need someone today: blocked, overdue, due today. Same urgency
 * definitions as the board's filters and reports; done tasks never count.
 */
async function tasksNeedingAttention(ws: Workspace, at: Date): Promise<ReportSection> {
  const wf = await loadWorkflow(db, ws.id)
  const today = localDayKey(at, ws.timezone)
  const rows = await db.workTask.findMany({
    where: { workspaceId: ws.id, deletedAt: null, OR: [{ blockedAt: { not: null } }, { dueDate: { not: null } }] },
    select: { taskKey: true, title: true, status: true, dueDate: true, blockedAt: true, blockedReason: true, assignee: { select: { user: { include: { profile: true } } } } },
  })
  const ctx = { today, now: at.getTime(), isDone: wf.isDone }
  type Row = (typeof rows)[number] & { due: string | null; why: string; order: number }
  const found: Row[] = []
  for (const t of rows) {
    const due = t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null
    const view = { status: t.status, dueDate: due, blocked: t.blockedAt }
    const reasons: string[] = []
    if (isUrgent(view, 'blocked', ctx)) reasons.push(t.blockedReason ? `blocked: ${t.blockedReason}` : 'blocked')
    if (isUrgent(view, 'overdue', ctx)) reasons.push(`overdue since ${localDate(new Date(`${due}T12:00:00Z`), 'UTC')}`)
    else if (due === today && !wf.isDone(t.status)) reasons.push('due today')
    if (!reasons.length) continue
    found.push({ ...t, due, why: reasons.join(' · '), order: t.blockedAt ? 0 : due! < today ? 1 : 2 })
  }
  // Blocked first, then the longest overdue, then due today.
  found.sort((a, b) => a.order - b.order || (a.due ?? '').localeCompare(b.due ?? '') || a.taskKey.localeCompare(b.taskKey))
  const shown = found.slice(0, LINE_CAP)
  return {
    key: 'tasks',
    title: 'Tasks needing attention',
    count: found.length,
    lines: more(shown.map((t) => `${t.taskKey} ${t.title} · ${t.why} · ${t.assignee ? toAuthor(t.assignee.user).name : 'unassigned'}`), found.length),
    links: [],
  }
}

async function agentFailures(ws: Workspace, at: Date): Promise<ReportSection> {
  const where = { workspaceId: ws.id, status: 'failed' as const, completedAt: { gte: new Date(at.getTime() - DAY_MS), lt: at } }
  const [count, rows] = await Promise.all([
    db.agentEvent.count({ where }),
    db.agentEvent.findMany({ where, orderBy: { completedAt: 'desc' }, take: LINE_CAP, select: { failureSummary: true, agent: { select: { name: true } } } }),
  ])
  return {
    key: 'agentFailures',
    title: 'Agents needing attention',
    count,
    lines: more(rows.map((r) => `${r.agent.name}${r.failureSummary ? ` — ${r.failureSummary}` : ''}`), count),
    links: [],
  }
}

async function inventoryAlerts(ws: Workspace): Promise<ReportSection> {
  const where = { workspaceId: ws.id, status: 'active' as const, lowStock: true }
  const [count, rows] = await Promise.all([
    db.inventory.count({ where }),
    db.inventory.findMany({ where, orderBy: { quantity: 'asc' }, take: LINE_CAP, select: { name: true, quantity: true, lowStockThreshold: true } }),
  ])
  return {
    key: 'inventoryAlerts',
    title: 'Low stock',
    count,
    lines: more(rows.map((r) => `${r.name} · ${r.quantity ?? 0} left (alert at ${r.lowStockThreshold ?? 0})`), count),
    links: [],
  }
}

// ─── Daily Customer Report ─────────────────────────────────────────────────────

async function newContacts(ws: Workspace, at: Date): Promise<ReportSection> {
  const where = { workspaceId: ws.id, deletedAt: null, mergedIntoId: null, createdAt: { gte: new Date(at.getTime() - DAY_MS), lt: at } }
  const [count, rows] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({ where, orderBy: { createdAt: 'desc' }, take: LINE_CAP, select: { id: true, displayName: true, leadStatus: true } }),
  ])
  return {
    key: 'newContacts',
    title: 'New contacts',
    count,
    lines: more(rows.map((c) => `${c.displayName}${c.leadStatus === 'customer' ? ' · customer' : ''}`), count),
    links: rows.slice(0, LINK_CAP).map((c) => ({ type: 'contact', id: c.id, workspaceId: ws.id, title: c.displayName })),
  }
}

const STAGE: Record<string, string> = { new: 'New', contacting: 'Contacting', connected: 'Connected', qualified: 'Qualified', customer: 'Customer', lost: 'Lost' }

/** Stage changes recorded by contact edits (the audit log), newest first, one per contact. */
async function stageChanges(ws: Workspace, at: Date): Promise<ReportSection> {
  const actions = await db.actionExecution.findMany({
    where: { workspaceId: ws.id, action: 'contact.update', status: 'succeeded', requestedAt: { gte: new Date(at.getTime() - DAY_MS), lt: at } },
    orderBy: { requestedAt: 'desc' },
    take: 500,
    select: { targetId: true, changes: true },
  })
  const latest = new Map<string, [string | null, string | null]>()
  for (const a of actions) {
    const change = (a.changes as Record<string, [string | null, string | null]> | null)?.leadStatus
    if (a.targetId && change && !latest.has(a.targetId)) latest.set(a.targetId, change)
  }
  const ids = [...latest.keys()]
  const contacts = ids.length ? await db.contact.findMany({ where: { workspaceId: ws.id, id: { in: ids }, deletedAt: null }, select: { id: true, displayName: true } }) : []
  const shown = contacts.slice(0, LINE_CAP)
  return {
    key: 'stageChanges',
    title: 'Stage changes',
    count: contacts.length,
    lines: more(
      shown.map((c) => {
        const [from, to] = latest.get(c.id)!
        return `${c.displayName} · ${from ? STAGE[from] ?? from : 'No stage'} → ${to ? STAGE[to] ?? to : 'No stage'}`
      }),
      contacts.length,
    ),
    links: shown.slice(0, LINK_CAP).map((c) => ({ type: 'contact', id: c.id, workspaceId: ws.id, title: c.displayName })),
  }
}

/** Open contacts (any stage but customer/lost) with no activity for 30 days. */
async function needsAttention(ws: Workspace, at: Date): Promise<ReportSection> {
  const quietSince = new Date(at.getTime() - 30 * DAY_MS)
  // Cast: leadStatus is an enum today and a workspace-defined stage key soon; both take strings.
  const where = {
    workspaceId: ws.id,
    deletedAt: null,
    mergedIntoId: null,
    status: 'active',
    leadStatus: { notIn: CLOSED_STAGES },
    OR: [{ lastActivityAt: { lt: quietSince } }, { lastActivityAt: null, createdAt: { lt: quietSince } }],
  } as Prisma.ContactWhereInput
  const [count, rows] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({ where, orderBy: [{ lastActivityAt: 'asc' }, { createdAt: 'asc' }], take: LINE_CAP, select: { id: true, displayName: true, lastActivityAt: true } }),
  ])
  return {
    key: 'needsAttention',
    title: 'Quiet for 30 days',
    count,
    lines: more(rows.map((c) => `${c.displayName} · ${c.lastActivityAt ? `last activity ${localDate(c.lastActivityAt, ws.timezone)}` : 'no activity yet'}`), count),
    links: rows.slice(0, LINK_CAP).map((c) => ({ type: 'contact', id: c.id, workspaceId: ws.id, title: c.displayName })),
  }
}

export const BRIEF_SECTIONS: SectionDef[] = [
  { key: 'activity', label: 'Important activity', build: importantActivity },
  { key: 'tasks', label: 'Tasks needing attention', build: tasksNeedingAttention },
  { key: 'followUpsDue', label: 'Follow-ups due', build: followUpsDue },
  { key: 'agentFailures', label: 'Agent failures', build: agentFailures },
  { key: 'inventoryAlerts', label: 'Inventory alerts', build: (ws) => inventoryAlerts(ws) },
]

export const CUSTOMER_SECTIONS: SectionDef[] = [
  { key: 'newContacts', label: 'New contacts', build: newContacts },
  { key: 'stageChanges', label: 'Stage changes', build: stageChanges },
  { key: 'followUpsDue', label: 'Follow-ups due', build: followUpsDue },
  { key: 'needsAttention', label: 'Needs attention', build: needsAttention },
]

export const sectionSummary = (s: ReportSection) => `${s.title}: ${s.count}`
export { plural }
