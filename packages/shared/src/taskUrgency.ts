// What "needs attention" means for a task, defined once for every surface
// (Board, Calendar, a future Table, reports). A task matches a set of urgency
// filters if it matches ANY of them (like the other filter groups); groups
// combine with AND.
//
// Done tasks (any done-category status) never need attention. Dates are calendar days (YYYY-MM-DD) in the
// viewer's or workspace's own time zone; `today` is passed in, never guessed.

export type UrgencyKey = 'overdue' | 'due_week' | 'recent' | 'blocked'

export const URGENCY: { key: UrgencyKey; label: string; hint: string }[] = [
  { key: 'overdue', label: 'Overdue', hint: 'Due before today and not done' },
  { key: 'due_week', label: 'Due this week', hint: 'Due today through Sunday and not done' },
  { key: 'recent', label: 'Updated today', hint: 'Changed in the last 24 hours' },
  { key: 'blocked', label: 'Blocked', hint: 'Flagged as waiting on something and not done' },
]

export const RECENT_MS = 24 * 60 * 60 * 1000

/** The fields urgency looks at (server Task and the web's card both have them). */
export type UrgencyTask = {
  status: string
  dueDate?: string | null
  updatedAt?: string | Date | null
  blocked?: unknown
}

export type UrgencyContext = {
  today: string
  now: number
  /** Whether a status counts as done (the workspace workflow); defaults to the key 'done'. */
  isDone?: (status: string) => boolean
}

/** Sunday of today's week (weeks run Monday–Sunday), as YYYY-MM-DD. */
export function weekEnd(today: string): string {
  const d = new Date(`${today}T12:00:00Z`)
  const toSunday = (7 - d.getUTCDay()) % 7
  d.setUTCDate(d.getUTCDate() + toSunday)
  return d.toISOString().slice(0, 10)
}

export function isUrgent(task: UrgencyTask, key: UrgencyKey, ctx: UrgencyContext): boolean {
  const done = ctx.isDone ? ctx.isDone(task.status) : task.status === 'done'
  switch (key) {
    case 'overdue':
      return !done && !!task.dueDate && task.dueDate < ctx.today
    case 'due_week':
      return !done && !!task.dueDate && task.dueDate >= ctx.today && task.dueDate <= weekEnd(ctx.today)
    case 'recent': {
      if (!task.updatedAt) return false
      const at = task.updatedAt instanceof Date ? task.updatedAt.getTime() : Date.parse(task.updatedAt)
      return ctx.now - at <= RECENT_MS
    }
    case 'blocked':
      return !done && !!task.blocked
  }
}

/** ANY of the chosen keys (none chosen = everything matches). */
export function matchesUrgency(task: UrgencyTask, keys: readonly UrgencyKey[], ctx: UrgencyContext): boolean {
  return !keys.length || keys.some((k) => isUrgent(task, k, ctx))
}

export const isUrgencyKey = (v: string): v is UrgencyKey => URGENCY.some((u) => u.key === v)
