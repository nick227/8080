import { useMemo, useRef, useState } from 'react'
import { isUrgent } from '@project/shared'
import { Avatar, since, useParentKey } from './BoardView'
import { FIELDS, openField, setField, targetsFor, taskShortcut } from './actions'
import { todayKey } from './dates'
import { useCalendar, useWorkflow, type PickerField } from './store'
import type { Workflow } from '@project/shared'
import { useTeam } from './sync'
import type { CalTask } from './types'

// A dense, editable list of the same tasks the board shows. Every field cell opens
// the shared picker (actions.ts), so a cell, a card chip, a shortcut and the bulk
// bar all make the same write.

type SortKey = 'key' | 'title' | 'status' | 'assignee' | 'priority' | 'type' | 'area' | 'points' | 'due' | 'day' | 'updated'
type GroupKey = 'none' | 'status' | 'assignee' | 'priority' | 'type' | 'area'

const PRIORITY_ORDER: Record<string, number> = { highest: 0, high: 1, medium: 2, low: 3 }
const PRIORITY_LABEL: Record<string, string> = { highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low' }
const TYPE_LABEL: Record<string, string> = { task: 'Task', feature: 'Feature', bug: 'Bug', story: 'Story', epic: 'Epic' }

const COLUMNS: { key: SortKey; label: string; field?: PickerField; className?: string }[] = [
  { key: 'key', label: 'Key', className: 'cal-col-key' },
  { key: 'title', label: 'Title', className: 'cal-col-title' },
  { key: 'status', label: 'Status', field: 'status' },
  { key: 'assignee', label: 'Assignee', field: 'assignee' },
  { key: 'priority', label: 'Priority', field: 'priority' },
  { key: 'type', label: 'Type', field: 'type' },
  { key: 'area', label: 'Area', field: 'area' },
  { key: 'points', label: 'Pts', field: 'points', className: 'cal-col-num' },
  { key: 'due', label: 'Due', field: 'due' },
  { key: 'day', label: 'Calendar', field: 'day' },
  { key: 'updated', label: 'Updated' },
]

function sortValue(t: CalTask, key: SortKey, wf: Workflow): string | number {
  switch (key) {
    case 'key': return Number(t.taskKey.replace(/\D/g, '')) || 0
    case 'title': return t.title.toLowerCase()
    case 'status': return wf.order(t.status) * 1e9 + t.rank
    case 'assignee': return (t.assigneeName ?? '￿').toLowerCase()
    case 'priority': return PRIORITY_ORDER[t.priority ?? 'medium']!
    case 'type': return t.category ?? 'task'
    case 'area': return (t.area ?? '￿').toLowerCase()
    case 'points': return t.storyPoints ?? -1
    case 'due': return t.dueDate ?? '9999'
    case 'day': return t.day ?? '9999'
    case 'updated': return t.updatedAt ?? ''
  }
}

function groupOf(t: CalTask, key: GroupKey, wf: Workflow): { id: string; label: string; order: number | string } {
  switch (key) {
    case 'status': return { id: t.status, label: wf.label(t.status), order: wf.order(t.status) }
    case 'assignee': return { id: t.assigneeId ?? '', label: t.assigneeName ?? 'Unassigned', order: t.assigneeName ? t.assigneeName.toLowerCase() : '￿' }
    case 'priority': return { id: t.priority ?? 'medium', label: PRIORITY_LABEL[t.priority ?? 'medium']!, order: PRIORITY_ORDER[t.priority ?? 'medium']! }
    case 'type': return { id: t.category ?? 'task', label: TYPE_LABEL[t.category ?? 'task']!, order: t.category ?? 'task' }
    case 'area': return { id: t.area ?? '', label: t.area ?? 'No area', order: t.area ?? '￿' }
    default: return { id: 'all', label: 'All', order: 0 }
  }
}

export function TableView({ tasks, onSelectTask, filtersOn, onClearFilters }: { tasks: CalTask[]; onSelectTask: (task: CalTask) => void; filtersOn: boolean; onClearFilters: () => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 })
  const [group, setGroup] = useState<GroupKey>('none')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const selection = useCalendar((s) => s.selection)
  const selectMany = useCalendar((s) => s.selectMany)
  const toggleSelect = useCalendar((s) => s.toggleSelect)
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const workflow = useWorkflow()

  const sorted = useMemo(() => {
    const rows = [...tasks]
    rows.sort((a, b) => {
      const x = sortValue(a, sort.key, workflow)
      const y = sortValue(b, sort.key, workflow)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.rank - b.rank
    })
    return rows
  }, [tasks, sort, workflow])

  const groups = useMemo(() => {
    if (group === 'none') return [{ id: 'all', label: '', rows: sorted }]
    const map = new Map<string, { id: string; label: string; order: number | string; rows: CalTask[] }>()
    for (const t of sorted) {
      const g = groupOf(t, group, workflow)
      if (!map.has(g.id)) map.set(g.id, { ...g, rows: [] })
      map.get(g.id)!.rows.push(t)
    }
    return [...map.values()].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  }, [sorted, group, workflow])

  const visibleIds = groups.flatMap((g) => (collapsed.has(g.id) ? [] : g.rows.map((r) => r.id)))
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.includes(id))
  const points = tasks.reduce((n, t) => n + (t.storyPoints ?? 0), 0)

  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))

  const moveFocus = (from: HTMLElement, step: 1 | -1) => {
    const rows = [...(bodyRef.current?.querySelectorAll<HTMLElement>('tr[data-task-id]') ?? [])]
    rows[rows.indexOf(from) + step]?.focus()
  }

  if (!tasks.length) {
    return (
      <div className="cal-table-view">
        <p className="cal-board-note" role="status">
          {filtersOn ? <>No tasks match these filters. <button type="button" className="cal-link-btn" onClick={onClearFilters}>Clear filters</button></> : 'No tasks yet. Press C or use + New to add one.'}
        </p>
      </div>
    )
  }

  return (
    <div className="cal-table-view" role="region" aria-label="Task table">
      <div className="cal-table-tools">
        <label>
          Group by
          <select value={group} onChange={(e) => { setGroup(e.target.value as GroupKey); setCollapsed(new Set()) }}>
            <option value="none">Nothing</option>
            <option value="status">Status</option>
            <option value="assignee">Assignee</option>
            <option value="priority">Priority</option>
            <option value="type">Type</option>
            <option value="area">Area</option>
          </select>
        </label>
        {points > 0 && <span className="cal-view-count">{points} pts shown</span>}
      </div>
      <div className="cal-table-scroll">
        <table className="cal-table">
          <thead>
            <tr>
              <th className="cal-col-check">
                <input type="checkbox" aria-label={allSelected ? 'Unselect all shown' : 'Select all shown'} checked={allSelected} onChange={() => selectMany(visibleIds, !allSelected)} />
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key} className={c.className} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => sortBy(c.key)}>
                    {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {groups.map((g) => (
              <GroupRows key={g.id} group={g} grouped={group !== 'none'} collapsed={collapsed.has(g.id)}
                onToggle={() => setCollapsed((c) => { const n = new Set(c); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n })}
                selection={selection} toggleSelect={toggleSelect} onOpen={onSelectTask} moveFocus={moveFocus} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GroupRows({ group, grouped, collapsed, onToggle, selection, toggleSelect, onOpen, moveFocus }: {
  group: { id: string; label: string; rows: CalTask[] }
  grouped: boolean
  collapsed: boolean
  onToggle: () => void
  selection: string[]
  toggleSelect: (id: string) => void
  onOpen: (t: CalTask) => void
  moveFocus: (from: HTMLElement, step: 1 | -1) => void
}) {
  return (
    <>
      {grouped && (
        <tr className="cal-table-group">
          <th colSpan={COLUMNS.length + 1} scope="rowgroup">
            <button type="button" aria-expanded={!collapsed} onClick={onToggle}>
              {collapsed ? '▸' : '▾'} {group.label} <span>{group.rows.length}</span>
            </button>
          </th>
        </tr>
      )}
      {!collapsed && group.rows.map((t) => <Row key={t.id} task={t} selected={selection.includes(t.id)} toggleSelect={toggleSelect} onOpen={onOpen} moveFocus={moveFocus} />)}
    </>
  )
}

function Row({ task, selected, toggleSelect, onOpen, moveFocus }: { task: CalTask; selected: boolean; toggleSelect: (id: string) => void; onOpen: (t: CalTask) => void; moveFocus: (from: HTMLElement, step: 1 | -1) => void }) {
  const { team, meId } = useTeam()
  const [editing, setEditing] = useState(false)
  const parentKey = useParentKey(task.parentTaskId)
  const workflow = useWorkflow()
  const done = workflow.isDone(task.status)
  const today = todayKey()
  const ctx = { today, now: Date.now(), isDone: workflow.isDone }
  const overdue = isUrgent(task, 'overdue', ctx)

  const cell = (field: PickerField, content: React.ReactNode, label: string) => (
    <button type="button" className="cal-cell" disabled={task.pending} aria-label={`${FIELDS[field].label}: ${label}. Change`}
      onClick={(e) => { e.stopPropagation(); openField(field, targetsFor(task.id), e.currentTarget) }}>
      {content}
    </button>
  )

  return (
    <tr
      data-task-id={task.id}
      data-selected={selected || undefined}
      data-pending={task.pending || undefined}
      data-done={done || undefined}
      tabIndex={0}
      aria-label={`${task.taskKey} ${task.title}`}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter') { e.preventDefault(); onOpen(task); return }
        if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveFocus(e.currentTarget, 1); return }
        if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); moveFocus(e.currentTarget, -1); return }
        if (e.key === 'F2') { e.preventDefault(); setEditing(true); return }
        if (!task.pending && !e.metaKey && !e.ctrlKey && !e.altKey && taskShortcut(e, task.id, e.currentTarget, team, meId, () => toggleSelect(task.id))) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
    >
      <td className="cal-col-check"><input type="checkbox" aria-label={`Select ${task.taskKey}`} checked={selected} disabled={task.pending} onChange={() => toggleSelect(task.id)} /></td>
      <td className="cal-col-key"><span className="cal-ticket-key-tag">{task.taskKey}</span></td>
      <td className="cal-col-title">
        {editing ? (
          <TitleEditor task={task} onDone={() => setEditing(false)} />
        ) : (
          <span className="cal-title-cell">
            {parentKey && <span className="cal-parent-chip" title={`Subtask of ${parentKey}`}>↳ {parentKey}</span>}
            <button type="button" className="cal-title-link" disabled={task.pending} onClick={() => onOpen(task)} title="Open">
              {task.title}
            </button>
            <button type="button" className="cal-icon-btn cal-rename-btn" disabled={task.pending} aria-label={`Rename ${task.taskKey}`} title="Rename (F2)" onClick={() => setEditing(true)}>✎</button>
            {task.blocked && !done && <span className="cal-table-blocked" title={task.blocked.reason}>Blocked</span>}
          </span>
        )}
      </td>
      <td>{cell('status', workflow.label(task.status), workflow.label(task.status))}</td>
      <td>{cell('assignee', <><Avatar name={task.assigneeName ?? null} url={task.assigneeAvatar ?? null} /><span>{task.assigneeName ?? 'Unassigned'}</span></>, task.assigneeName ?? 'Unassigned')}</td>
      <td>{cell('priority', <span data-priority={task.priority ?? 'medium'}>{PRIORITY_LABEL[task.priority ?? 'medium']}</span>, PRIORITY_LABEL[task.priority ?? 'medium']!)}</td>
      <td>{cell('type', TYPE_LABEL[task.category ?? 'task'], TYPE_LABEL[task.category ?? 'task']!)}</td>
      <td>{cell('area', task.area ?? '—', task.area ?? 'none')}</td>
      <td className="cal-col-num">{cell('points', task.storyPoints ?? '—', String(task.storyPoints ?? 'none'))}</td>
      <td>{cell('due', <span data-overdue={overdue || undefined}>{task.dueDate ? shortDate(task.dueDate) : '—'}</span>, task.dueDate ?? 'none')}</td>
      <td>{cell('day', task.day ? shortDate(task.day) : '—', task.day ?? 'none')}</td>
      <td className="cal-col-updated">{task.updatedAt ? since(task.updatedAt) : ''}</td>
    </tr>
  )
}

function TitleEditor({ task, onDone }: { task: CalTask; onDone: () => void }) {
  const updateTask = useCalendar((s) => s.updateTask)
  const [value, setValue] = useState(task.title)
  const save = () => {
    const clean = value.trim()
    if (clean && clean !== task.title) updateTask(task.id, { title: clean })
    onDone()
  }
  return (
    <input
      className="cal-title-input"
      aria-label={`New title for ${task.taskKey}`}
      autoFocus
      maxLength={255}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); save() }
        if (e.key === 'Escape') { e.preventDefault(); onDone() }
      }}
    />
  )
}

function shortDate(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
