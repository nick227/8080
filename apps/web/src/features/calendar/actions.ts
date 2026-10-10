// The one control system for editing tasks. The card menu, card chips, keyboard
// shortcuts, the bulk bar and table cells all go through these definitions and
// `setField` — never their own mutation paths. One id = the single-task write;
// several = one bulk write. Both end in the same store (optimistic, versioned).
import { useCalendar, type BulkChange, type PickerField } from './store'
import { AREAS, STATUSES, TASK_TYPES, type CalTask, type TaskPriority, type TaskStatus, type TaskType, type TeamMember } from './types'

export type FieldOption = { value: string; label: string; hint?: string; avatar?: { name: string | null; url: string | null } }

type FieldDef = {
  label: string
  /** Shortcut on a focused card or row (and on the selection). */
  key: string
  kind: 'choice' | 'date' | 'reason'
  options?: (team: TeamMember[], meId: string | null) => FieldOption[]
  /** The value shown as current, for one task. */
  current: (task: CalTask) => string | null
}

const TYPE_LABEL: Record<TaskType, string> = { task: 'Task', feature: 'Feature', bug: 'Bug', story: 'Story', epic: 'Epic' }
const PRIORITY: { value: TaskPriority; label: string }[] = [
  { value: 'highest', label: 'Highest' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]
const POINTS = [1, 2, 3, 5, 8, 13]

export const FIELDS: Record<PickerField, FieldDef> = {
  status: { label: 'Status', key: 's', kind: 'choice', options: () => STATUSES.map((s) => ({ value: s.id, label: s.title })), current: (t) => t.status },
  assignee: {
    label: 'Assignee',
    key: 'a',
    kind: 'choice',
    options: (team, meId) => [
      { value: '', label: 'Unassigned', avatar: { name: null, url: null } },
      ...[...team].sort((x, y) => (x.id === meId ? -1 : y.id === meId ? 1 : x.name.localeCompare(y.name))).map((m) => ({
        value: m.id,
        label: m.id === meId ? `${m.name} (me)` : m.name,
        avatar: { name: m.name, url: m.avatarUrl ?? null },
      })),
    ],
    current: (t) => t.assigneeId ?? '',
  },
  priority: { label: 'Priority', key: 'p', kind: 'choice', options: () => PRIORITY, current: (t) => t.priority ?? 'medium' },
  type: { label: 'Type', key: 't', kind: 'choice', options: () => TASK_TYPES.map((v) => ({ value: v, label: TYPE_LABEL[v] })), current: (t) => t.category ?? 'task' },
  area: { label: 'Area', key: 'r', kind: 'choice', options: () => [{ value: '', label: 'None' }, ...AREAS.map((a) => ({ value: a, label: a }))], current: (t) => t.area ?? '' },
  points: { label: 'Points', key: 'e', kind: 'choice', options: () => [{ value: '', label: 'None' }, ...POINTS.map((n) => ({ value: String(n), label: String(n) }))], current: (t) => (t.storyPoints == null ? '' : String(t.storyPoints)) },
  due: { label: 'Due date', key: 'd', kind: 'date', current: (t) => t.dueDate ?? '' },
  day: { label: 'Calendar day', key: '', kind: 'date', current: (t) => t.day ?? '' },
  blocked: { label: 'Blocked', key: 'b', kind: 'reason', current: (t) => t.blocked?.reason ?? '' },
}

/** Fields in the order menus and the bulk bar list them. */
export const FIELD_ORDER: PickerField[] = ['status', 'assignee', 'priority', 'due', 'type', 'area', 'points', 'day', 'blocked']

const store = () => useCalendar.getState()

/** The change one field value means, for the store (and the server's bulk patch). */
function changeFor(field: PickerField, value: string | null, team: TeamMember[]): BulkChange {
  switch (field) {
    case 'status': return { status: value as TaskStatus }
    case 'assignee': {
      const m = team.find((x) => x.id === value)
      return { assigneeId: m?.id ?? null, assigneeName: m?.name ?? null, assigneeAvatar: m?.avatarUrl ?? null }
    }
    case 'priority': return { priority: value as TaskPriority }
    case 'type': return { category: value as TaskType }
    case 'area': return { area: value || null }
    case 'points': return { storyPoints: value ? Number(value) : null }
    case 'due': return { dueDate: value || null }
    case 'day': return { day: value || null }
    case 'blocked': return { blocked: value?.trim() ? { reason: value.trim() } : null }
  }
}

/** Set one field on one or many tasks. The only write path for inline and bulk edits. */
export function setField(ids: string[], field: PickerField, value: string | null, team: TeamMember[]) {
  const s = store()
  const live = ids.filter((id) => s.tasks.some((t) => t.id === id))
  if (!live.length) return
  if (live.length > 1) {
    s.updateMany(live, changeFor(field, value, team))
    return
  }
  const id = live[0]!
  if (field === 'status') return s.moveTask(id, value as TaskStatus, {})
  if (field === 'blocked') return value?.trim() ? s.block(id, value) : s.unblock(id)
  const { blocked: _ignored, ...patch } = changeFor(field, value, team)
  s.updateTask(id, patch)
}

/** Value shown for a field across several tasks: the shared one, or null when they differ. */
export function sharedValue(field: PickerField, tasks: CalTask[]): string | null {
  const values = new Set(tasks.map((t) => FIELDS[field].current(t)))
  return values.size === 1 ? [...values][0]! : null
}

/** Open the shared picker for `ids`, anchored to an element. */
export function openField(field: PickerField, ids: string[], anchor: Element | null) {
  const r = anchor?.getBoundingClientRect()
  store().openPicker({ field, ids, anchor: r ? { x: r.left, y: r.bottom, w: r.width, h: r.height } : { x: window.innerWidth / 2 - 120, y: 120, w: 0, h: 0 } })
}

/** Quick actions that aren't a field (menu items and shortcuts). */
export function assignToMe(ids: string[], team: TeamMember[], meId: string | null) {
  if (meId) setField(ids, 'assignee', meId, team)
}

export function deleteTasks(ids: string[]) {
  const s = store()
  if (ids.length === 1) s.remove(ids[0]!)
  else s.removeMany(ids)
}

/** Which tasks a shortcut acts on: the selection if the focused card is part of it, else the focused card. */
export function targetsFor(focusedId: string | null): string[] {
  const sel = store().selection
  if (focusedId && sel.includes(focusedId)) return sel
  if (focusedId) return [focusedId]
  return sel
}

/** Shortcut key → field, built from the definitions. */
export const FIELD_BY_KEY: Record<string, PickerField> = Object.fromEntries((Object.keys(FIELDS) as PickerField[]).filter((f) => FIELDS[f].key).map((f) => [FIELDS[f].key, f]))

/**
 * Shortcuts on a focused card or table row (acting on the selection it belongs to).
 * Returns true when the key was handled. The board and the table both use this.
 */
export function taskShortcut(e: { key: string; shiftKey: boolean }, id: string, el: Element, team: TeamMember[], meId: string | null, toggleSelect: () => void): boolean {
  const ids = targetsFor(id)
  const field = FIELD_BY_KEY[e.key.toLowerCase()]
  if (field && !e.shiftKey) {
    openField(field, ids, el)
    return true
  }
  if (e.key === 'i') { assignToMe(ids, team, meId); return true }
  if (e.key === 'x') { toggleSelect(); return true }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteTasks(ids); return true }
  return false
}
