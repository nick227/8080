// Board reports, derived from the recorded Activity rows (the one event model)
// and current task state. Days and weeks (Monday start) are the workspace's own,
// in its time zone. "Done" and "started" come from workflow categories; "needs
// attention" from the shared urgency definitions — the same ones the board uses.
import { db } from '@project/db'
import { isUrgent } from '@project/shared'
import { badRequest } from '../lib/errors'
import { toAuthor } from '../lib/serialize'
import { localDayKey } from '../lib/workspaceDay'
import { loadWorkflow } from './TaskWorkflowService'
import { authorize } from './workspacePolicy'

const DAY_MS = 86_400_000

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Monday of the week containing `day`. */
function weekStart(day: string) {
  const d = new Date(`${day}T12:00:00Z`)
  return addDays(day, -((d.getUTCDay() + 6) % 7))
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null
  const at = (sorted.length - 1) * p
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return Math.round((sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo)) * 10) / 10
}

type Move = { taskId: string; at: Date; day: string; from: string; to: string }

export async function taskReport(userId: string, workspaceId: string, opts: { weeks?: number }) {
  const actor = await authorize(userId, workspaceId, 'task.read')
  const weeks = opts.weeks ?? 8
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 26) throw badRequest('weeks must be 1–26', 'INVALID_RANGE')
  const tz = actor.workspace.timezone || 'UTC'
  const wf = await loadWorkflow(db, workspaceId)
  const now = new Date()
  const today = localDayKey(now, tz)
  const firstWeek = addDays(weekStart(today), -7 * (weeks - 1))
  const previousFrom = addDays(firstWeek, -7 * weeks)
  // Load a little before the previous period so time-zone edges don't drop events.
  const since = new Date(Date.parse(`${previousFrom}T00:00:00Z`) - DAY_MS)

  const [tasks, moveRows, createdRows] = await Promise.all([
    db.workTask.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, status: true, dueDate: true, blockedAt: true, assigneeMemberId: true, createdAt: true, updatedAt: true, assignee: { include: { user: { include: { profile: true } } } } },
    }),
    db.activity.findMany({ where: { workspaceId, type: 'task.moved', occurredAt: { gte: since } }, select: { taskId: true, occurredAt: true, summary: true }, orderBy: { occurredAt: 'asc' } }),
    db.activity.findMany({ where: { workspaceId, type: 'task.created', occurredAt: { gte: since } }, select: { taskId: true, occurredAt: true } }),
  ])
  const toMove = (r: { taskId: string | null; occurredAt: Date; summary: unknown }): Move | null => {
    const s = r.summary as { from?: string; to?: string }
    if (!r.taskId || !s?.from || !s?.to) return null
    return { taskId: r.taskId, at: r.occurredAt, day: localDayKey(r.occurredAt, tz), from: s.from, to: s.to }
  }
  const moves = moveRows.map(toMove).filter((m): m is Move => !!m)

  // ─── now ──────────────────────────────────────────────────────────────────
  const ctx = { today, now: now.getTime(), isDone: wf.isDone }
  const view = (t: (typeof tasks)[number]) => ({ status: t.status, dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, updatedAt: t.updatedAt, blocked: t.blockedAt })
  const category = (key: string) => wf.get(key)?.category ?? (wf.isDone(key) ? 'done' : 'todo')
  const open = tasks.filter((t) => !wf.isDone(t.status))
  const nowCounts = {
    todo: open.filter((t) => category(t.status) === 'todo').length,
    doing: open.filter((t) => category(t.status) === 'doing').length,
    overdue: tasks.filter((t) => isUrgent(view(t), 'overdue', ctx)).length,
    dueWeek: tasks.filter((t) => isUrgent(view(t), 'due_week', ctx)).length,
    blocked: tasks.filter((t) => isUrgent(view(t), 'blocked', ctx)).length,
  }

  // ─── throughput: tasks that reached done, per week (each task once per week) ──
  const doneMoves = moves.filter((m) => wf.isDone(m.to) && !wf.isDone(m.from))
  const weekKeys = Array.from({ length: weeks }, (_, i) => addDays(firstWeek, 7 * i))
  const perWeek = new Map(weekKeys.map((w) => [w, new Set<string>()]))
  let previous = 0
  const previousSeen = new Set<string>()
  for (const m of doneMoves) {
    if (m.day >= firstWeek) perWeek.get(weekStart(m.day))?.add(m.taskId)
    else if (m.day >= previousFrom && !previousSeen.has(m.taskId)) { previousSeen.add(m.taskId); previous++ }
  }
  const throughput = weekKeys.map((w) => ({ weekStart: w, done: perWeek.get(w)!.size }))

  // ─── cycle time: first left to-do (or created) → reached done ──────────────
  const doneInRange = doneMoves.filter((m) => m.day >= firstWeek)
  const ids = [...new Set(doneInRange.map((m) => m.taskId))]
  // Starts can predate the window: load those tasks' full move history.
  const history = ids.length
    ? (await db.activity.findMany({ where: { workspaceId, type: 'task.moved', taskId: { in: ids } }, select: { taskId: true, occurredAt: true, summary: true }, orderBy: { occurredAt: 'asc' } }))
        .map(toMove).filter((m): m is Move => !!m)
    : []
  const created = new Map<string, Date>()
  for (const r of createdRows) if (r.taskId) created.set(r.taskId, r.occurredAt)
  for (const t of tasks) if (!created.has(t.id)) created.set(t.id, t.createdAt)
  const missing = ids.filter((id) => !created.has(id))
  if (missing.length) {
    for (const t of await db.workTask.findMany({ where: { id: { in: missing } }, select: { id: true, createdAt: true } })) created.set(t.id, t.createdAt)
  }
  const samples: { week: string; hours: number }[] = []
  for (const end of doneInRange) {
    const own = history.filter((m) => m.taskId === end.taskId && m.at <= end.at)
    const started = own.find((m) => category(m.from) === 'todo' && category(m.to) !== 'todo')?.at ?? created.get(end.taskId)
    if (!started) continue
    samples.push({ week: weekStart(end.day), hours: Math.max(0, (end.at.getTime() - started.getTime()) / 3_600_000) })
  }
  const hours = samples.map((s) => s.hours).sort((a, b) => a - b)
  const cycleTime = {
    medianHours: percentile(hours, 0.5),
    p85Hours: percentile(hours, 0.85),
    samples: hours.length,
    weekly: weekKeys.map((w) => {
      const h = samples.filter((s) => s.week === w).map((s) => s.hours).sort((a, b) => a - b)
      return { weekStart: w, medianHours: percentile(h, 0.5), p85Hours: percentile(h, 0.85), samples: h.length }
    }),
  }

  // ─── cumulative flow: counts by category at the end of each day ────────────
  // Rebuilt backwards from today's state by undoing each later move (live tasks).
  const flowFrom = firstWeek
  const days: string[] = []
  for (let d = flowFrom; d <= today; d = addDays(d, 1)) days.push(d)
  const liveIds = new Set(tasks.map((t) => t.id))
  const movesByTask = new Map<string, Move[]>()
  for (const m of moves) {
    if (!liveIds.has(m.taskId) || m.day < flowFrom) continue
    if (!movesByTask.has(m.taskId)) movesByTask.set(m.taskId, [])
    movesByTask.get(m.taskId)!.push(m)
  }
  const counts = days.map((day) => ({ day, todo: 0, doing: 0, done: 0 }))
  for (const t of tasks) {
    const born = localDayKey(created.get(t.id) ?? t.createdAt, tz)
    const later = [...(movesByTask.get(t.id) ?? [])].sort((a, b) => b.at.getTime() - a.at.getTime())
    let status = t.status
    let i = 0
    for (let d = days.length - 1; d >= 0; d--) {
      const day = days[d]!
      // Undo moves that happened after this day ended.
      while (i < later.length && later[i]!.day > day) status = later[i++]!.from
      if (born > day) break
      counts[d]![category(status) as 'todo' | 'doing' | 'done']++
    }
  }

  // ─── open work per person ──────────────────────────────────────────────────
  const people = new Map<string, { memberId: string | null; name: string; todo: number; doing: number; blocked: number; overdue: number }>()
  for (const t of open) {
    const key = t.assigneeMemberId ?? ''
    if (!people.has(key)) people.set(key, { memberId: t.assigneeMemberId, name: t.assignee ? toAuthor(t.assignee.user).name : 'Unassigned', todo: 0, doing: 0, blocked: 0, overdue: 0 })
    const p = people.get(key)!
    if (category(t.status) === 'doing') p.doing++
    else p.todo++
    if (t.blockedAt) p.blocked++
    if (isUrgent(view(t), 'overdue', ctx)) p.overdue++
  }

  return {
    range: { from: firstWeek, to: today, weeks, timezone: tz },
    now: nowCounts,
    done: { thisPeriod: doneInRange.length ? new Set(doneInRange.map((m) => m.taskId)).size : 0, previousPeriod: previous },
    throughput,
    cycleTime,
    flow: counts,
    people: [...people.values()].sort((a, b) => b.doing + b.todo - (a.doing + a.todo) || a.name.localeCompare(b.name)),
  }
}

export type TaskReport = Awaited<ReturnType<typeof taskReport>>
