// A workspace's task workflow: its statuses (board columns), in order. Code asks
// a status's category, never its key: "done" means any done-category status.
// Defaults keep the original four, so existing tasks and links keep working.

export type StatusCategory = 'todo' | 'doing' | 'done'

export type StatusDef = {
  key: string
  label: string
  category: StatusCategory
  position: number
  /** Moving a task into this status tells its creator and assignee (a handoff). */
  handoff: boolean
  archived: boolean
}

export const STATUS_CATEGORIES: { key: StatusCategory; label: string }[] = [
  { key: 'todo', label: 'To do' },
  { key: 'doing', label: 'In progress' },
  { key: 'done', label: 'Done' },
]

export const DEFAULT_TASK_STATUSES: StatusDef[] = [
  { key: 'open', label: 'To do', category: 'todo', position: 0, handoff: false, archived: false },
  { key: 'in_progress', label: 'In progress', category: 'doing', position: 1, handoff: false, archived: false },
  { key: 'in_review', label: 'In review', category: 'doing', position: 2, handoff: true, archived: false },
  { key: 'done', label: 'Done', category: 'done', position: 3, handoff: true, archived: false },
]

export const STATUS_KEY = /^[a-z][a-z0-9_]{0,31}$/
export const MAX_STATUSES = 12

/** A key for a new status from its label ("Ready for QA" → "ready_for_qa"), unique among `taken`. */
export function statusKeyFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = (label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'status').replace(/^([0-9])/, 's_$1').slice(0, 28)
  let key = base
  for (let n = 2; used.has(key); n++) key = `${base}_${n}`
  return key
}

/** Lookups over a workflow (active statuses in order; archived kept for labels). */
export function workflowOf(statuses: readonly StatusDef[]) {
  const all = [...statuses].sort((a, b) => a.position - b.position)
  const active = all.filter((s) => !s.archived)
  const byKey = new Map(all.map((s) => [s.key, s]))
  const first = (category: StatusCategory) => active.find((s) => s.category === category)?.key ?? null
  return {
    all,
    active,
    get: (key: string) => byKey.get(key) ?? null,
    label: (key: string) => byKey.get(key)?.label ?? key,
    isDone: (key: string) => (byKey.get(key)?.category ?? (key === 'done' ? 'done' : 'todo')) === 'done',
    isActive: (key: string) => active.some((s) => s.key === key),
    /** Where new tasks start, and where "complete" sends a task. */
    firstTodo: first('todo') ?? active[0]?.key ?? 'open',
    firstDone: first('done') ?? 'done',
    order: (key: string) => {
      const at = active.findIndex((s) => s.key === key)
      return at < 0 ? active.length : at
    },
  }
}

export type Workflow = ReturnType<typeof workflowOf>
export const DEFAULT_WORKFLOW = workflowOf(DEFAULT_TASK_STATUSES)

/** Whether a set of statuses is usable: at least one active to-do and one active done status. */
export function workflowProblem(statuses: readonly Pick<StatusDef, 'category' | 'archived' | 'label' | 'key'>[]): string | null {
  const active = statuses.filter((s) => !s.archived)
  if (!active.some((s) => s.category === 'todo')) return 'Keep at least one To do status'
  if (!active.some((s) => s.category === 'done')) return 'Keep at least one Done status'
  if (statuses.length > MAX_STATUSES) return `At most ${MAX_STATUSES} statuses`
  if (statuses.some((s) => !s.label.trim() || s.label.length > 40)) return 'Every status needs a name of up to 40 characters'
  const labels = active.map((s) => s.label.trim().toLowerCase())
  if (new Set(labels).size !== labels.length) return 'Two statuses have the same name'
  return null
}
