import { forwardRef, useEffect, useRef, useState } from 'react'
import { Avatar } from './BoardView'
import { filtersActive, useCalendar, type Filters } from './store'
import { useTeam } from './sync'
import { URGENCY, isUrgent } from '@project/shared'
import { todayKey } from './dates'
import { AREAS, TASK_TYPES, type CalTask, type TaskPriority } from './types'

const TYPE_LABEL: Record<string, string> = { task: 'Task', feature: 'Feature', bug: 'Bug', story: 'Story', epic: 'Epic' }
const PRIORITIES: { id: TaskPriority; label: string }[] = [
  { id: 'highest', label: 'Highest' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
]

/** Filters apply to whatever the selected view shows. They live in the URL too. */
export const CalendarFilters = forwardRef<HTMLInputElement, { count: number; total: number; scoped: CalTask[] }>(function CalendarFilters({ count, total, scoped }, searchRef) {
  const filters = useCalendar((s) => s.filters)
  const setFilters = useCalendar((s) => s.setFilters)
  const clear = useCalendar((s) => s.clearFilters)
  const { team: members, meId } = useTeam()
  const tasks = useCalendar((s) => s.tasks)
  const ctx = { today: todayKey(), now: Date.now() }
  // People assigned work but missing from the member list (left, or just joined).
  const team = [...members]
  for (const t of tasks) {
    if (t.assigneeId && t.assigneeName && !team.some((m) => m.id === t.assigneeId)) team.push({ id: t.assigneeId, name: t.assigneeName, avatarUrl: t.assigneeAvatar ?? null })
  }
  const toggle = <K extends 'members' | 'types' | 'areas' | 'priorities' | 'urgency'>(key: K, value: Filters[K][number]) => {
    const list = filters[key] as string[]
    setFilters({ [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] } as Partial<Filters>)
  }
  const onlyMine = !!meId && filters.members.length === 1 && filters.members[0] === meId

  return (
    <div className="cal-filters" role="search" aria-label="Filter tasks">
      <input
        ref={searchRef}
        type="search"
        className="cal-search"
        aria-label="Search tasks"
        placeholder="Search tasks  /"
        value={filters.search}
        onChange={(e) => setFilters({ search: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') { setFilters({ search: '' }); e.currentTarget.blur() } }}
      />

      <div className="cal-member-filter" role="group" aria-label="Filter by assignee">
        {team.map((m) => (
          <button key={m.id} type="button" className="cal-member-toggle" aria-pressed={filters.members.includes(m.id)} title={m.name} aria-label={m.name} onClick={() => toggle('members', m.id)}>
            <Avatar name={m.name} url={m.avatarUrl ?? null} />
          </button>
        ))}
        <button type="button" className="cal-member-toggle" aria-pressed={filters.members.includes('unassigned')} title="Unassigned" aria-label="Unassigned" onClick={() => toggle('members', 'unassigned')}>
          <Avatar name={null} url={null} />
        </button>
      </div>
      {meId && (
        <button type="button" className="cal-btn" aria-pressed={onlyMine} onClick={() => setFilters({ members: onlyMine ? [] : [meId] })}>
          Only my tasks
        </button>
      )}
<div className="cal-urgency" role="group" aria-label="Needs attention">
        {URGENCY.map((u) => {
          const n = scoped.filter((t) => isUrgent(t, u.key, ctx)).length
          return (
            <button key={u.key} type="button" className="cal-urgency-chip" data-key={u.key} aria-pressed={filters.urgency.includes(u.key)} title={u.hint} onClick={() => toggle('urgency', u.key)}>
              {u.label}{n ? <span className="cal-urgency-count">{n}</span> : null}
            </button>
          )
        })}
      </div>

      <Pick label="Type" chosen={filters.types} options={TASK_TYPES.map((t) => ({ id: t, label: TYPE_LABEL[t]! }))} onToggle={(v) => toggle('types', v as Filters['types'][number])} />
      <Pick label="Area" chosen={filters.areas} options={AREAS.map((a) => ({ id: a, label: a }))} onToggle={(v) => toggle('areas', v)} />
      <Pick label="Priority" chosen={filters.priorities} options={PRIORITIES} onToggle={(v) => toggle('priorities', v as TaskPriority)} />

      <span className="cal-view-count" aria-live="polite">{count === total ? `${count} tasks` : `${count} of ${total} tasks`}</span>
      {filtersActive(filters) && <button className="cal-btn" type="button" onClick={clear}>Clear filters</button>}
    </div>
  )
})

/** A small multi-select: a button that opens a checklist. */
function Pick({ label, chosen, options, onToggle }: { label: string; chosen: string[]; options: { id: string; label: string }[]; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const summary = chosen.length === 0 ? 'All' : chosen.length === 1 ? options.find((o) => o.id === chosen[0])?.label ?? chosen[0] : `${chosen.length} selected`
  return (
    <div className="cal-pick" ref={ref}>
      <button type="button" className="cal-btn" aria-expanded={open} aria-pressed={chosen.length > 0} onClick={() => setOpen((v) => !v)}>
        {label}: {summary}
      </button>
      {open && (
        <fieldset className="cal-menu cal-pick-menu">
          <legend className="cal-menu-heading">{label}</legend>
          {options.map((o) => (
            <label key={o.id}>
              <input type="checkbox" checked={chosen.includes(o.id)} onChange={() => onToggle(o.id)} />
              {o.label}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}
