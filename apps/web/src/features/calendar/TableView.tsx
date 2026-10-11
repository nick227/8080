import { Link, useLocation } from 'react-router-dom'
import { taskPath } from '../tasks/links'
import { useMemo, useState, type ReactNode } from 'react'
import { isUrgent } from '@project/shared'
import { Avatar, since, useParentKey } from './BoardView'
import { FIELDS, openField, setField, targetsFor, taskShortcut } from './actions'
import { todayKey } from './dates'
import { useCalendar, useWorkflow, type PickerField } from './store'
import type { Workflow } from '@project/shared'
import { useTeam } from './sync'
import type { CalTask } from './types'
import { downloadCsv, tasksCsv } from './csv'
import { ColumnsMenu } from '../collections/ColumnsMenu'
import { DataTable } from '../collections/DataTable'
import { useTableState, type Column } from '../collections/table'

// A dense, editable list of the same tasks the board shows (on the shared collection
// table). Every field cell opens the shared picker (actions.ts), so a cell, a card chip,
// a shortcut and the bulk bar all make the same write.

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

/**
 * Tasks on the shared collection table (redesign D9). Sort lives in the URL; columns are
 * a per-viewer choice (Type, Area, Points and Calendar start hidden); Group by folds rows
 * under headers. Every field cell opens the shared picker (actions.ts); F2 renames; the
 * task shortcuts work on a focused row. Selection is the board's (the store's).
 */
export function TableView({ tasks, onSelectTask, filtersOn, onClearFilters }: { tasks: CalTask[]; onSelectTask: (task: CalTask) => void; filtersOn: boolean; onClearFilters: () => void }) {
  const [status, setStatus] = useState('all')
  const [group, setGroup] = useState<GroupKey>('none')
  const selection = useCalendar((s) => s.selection)
  const selectMany = useCalendar((s) => s.selectMany)
  const toggleSelect = useCalendar((s) => s.toggleSelect)
  const workflow = useWorkflow()
  const { team, meId } = useTeam()

  const columns = useMemo<Column<CalTask>[]>(() => {
    const field = (key: SortKey, f: PickerField, render: (t: CalTask) => ReactNode, label: (t: CalTask) => string, extra: Partial<Column<CalTask>> = {}): Column<CalTask> => ({
      id: key,
      header: COLUMNS.find((c) => c.key === key)!.label,
      sortValue: (t) => sortValue(t, key, workflow),
      cell: (t) => (
        <button type="button" className="cal-cell" disabled={t.pending} aria-label={`${FIELDS[f].label}: ${label(t)}. Change`}
          onClick={(e) => { e.stopPropagation(); openField(f, targetsFor(t.id), e.currentTarget) }}>
          {render(t)}
        </button>
      ),
      ...extra,
    })
    return [
      { id: 'key', header: 'Key', width: '6rem', hideable: false, className: 'cal-col-key', sortValue: (t) => sortValue(t, 'key', workflow), cell: (t) => <span className="cal-ticket-key-tag">{t.taskKey}</span> },
      { id: 'title', header: 'Title', width: '36%', hideable: false, className: 'cal-col-title', sortValue: (t) => sortValue(t, 'title', workflow), title: (t) => t.title, cell: (t, ctx) => <TitleCell task={t} row={ctx as RowCtx} /> },
      field('status', 'status', (t) => workflow.label(t.status), (t) => workflow.label(t.status), { width: '9rem' }),
      field('assignee', 'assignee', (t) => <><Avatar name={t.assigneeName ?? null} url={t.assigneeAvatar ?? null} /><span>{t.assigneeName ?? 'Unassigned'}</span></>, (t) => t.assigneeName ?? 'Unassigned', { width: '11rem' }),
      field('priority', 'priority', (t) => <span data-priority={t.priority ?? 'medium'}>{PRIORITY_LABEL[t.priority ?? 'medium']}</span>, (t) => PRIORITY_LABEL[t.priority ?? 'medium']!, { width: '7rem' }),
      field('type', 'type', (t) => TYPE_LABEL[t.category ?? 'task'], (t) => TYPE_LABEL[t.category ?? 'task']!, { defaultHidden: true }),
      field('area', 'area', (t) => t.area ?? '—', (t) => t.area ?? 'none', { defaultHidden: true }),
      field('points', 'points', (t) => t.storyPoints ?? '—', (t) => String(t.storyPoints ?? 'none'), { defaultHidden: true, align: 'end' }),
      field('due', 'due', (t) => <DueLabel task={t} />, (t) => t.dueDate ?? 'none', { width: '6.5rem' }),
      field('day', 'day', (t) => (t.day ? shortDate(t.day) : '—'), (t) => t.day ?? 'none', { defaultHidden: true }),
      { id: 'updated', header: 'Updated', firstDir: -1, className: 'cal-col-updated', sortValue: (t) => sortValue(t, 'updated', workflow), cell: (t) => (t.updatedAt ? since(t.updatedAt) : '') },
    ]
  }, [workflow])
  const table = useTableState('tasks', columns, { id: 'status', dir: 1 })

  const shown = useMemo(() => tasks.filter((task) => status === 'all' || (status === '!open' ? !workflow.isDone(task.status) : task.status === status)), [tasks, status, workflow])
  // Ties keep the board's order.
  const sorted = table.sortRows(shown, (a, b) => a.rank - b.rank)
  const selectionSet = useMemo(() => new Set(selection), [selection])
  const points = tasks.reduce((n, t) => n + (t.storyPoints ?? 0), 0)

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
      <div className="collection-bar cal-table-bar" role="toolbar" aria-label="Task table controls">
        <div className="collection-filters">
          <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option><option value="!open">Open tasks</option>
            {workflow.active.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <select aria-label="Group by" value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}>
            <option value="none">No grouping</option>
            <option value="status">Group by status</option>
            <option value="assignee">Group by assignee</option>
            <option value="priority">Group by priority</option>
            <option value="type">Group by type</option>
            <option value="area">Group by area</option>
          </select>
          {points > 0 && <span className="cal-view-count">{points} pts shown</span>}
        </div>
        <div className="collection-view-controls">
          <ColumnsMenu state={table} />
          <button type="button" className="collection-control" onClick={() => {
            // Display order (groups, then sort); a selection exports just those rows.
            const ordered = group === 'none' ? sorted : [...sorted].sort((a, b) => {
              const x = groupOf(a, group, workflow).order
              const y = groupOf(b, group, workflow).order
              return x < y ? -1 : x > y ? 1 : 0
            })
            const rows = selection.length ? ordered.filter((t) => selectionSet.has(t.id)) : ordered
            downloadCsv(`tasks-${todayKey()}.csv`, tasksCsv(rows, workflow))
          }}>
            {selection.length ? `Export ${selection.length} selected` : 'Export CSV'}
          </button>
        </div>
      </div>
      <DataTable
        label="Tasks"
        rows={sorted}
        getId={(t) => t.id}
        state={table}
        onOpen={onSelectTask}
        tableClass="cal-table"
        groupBy={group === 'none' ? undefined : (t) => groupOf(t, group, workflow)}
        useRow={useRowCtx}
        rowProps={(t) => ({ 'data-pending': t.pending ? '' : undefined, 'data-done': workflow.isDone(t.status) ? '' : undefined, 'aria-label': `${t.taskKey} ${t.title}` })}
        selection={{
          selected: selectionSet,
          disabled: (t) => !!t.pending,
          onChange: (next) => {
            const add = [...next].filter((id) => !selectionSet.has(id))
            const remove = selection.filter((id) => !next.has(id))
            if (add.length) selectMany(add, true)
            if (remove.length) selectMany(remove, false)
          },
        }}
        onRowKey={(e, t, ctx) => {
          if (e.key === 'F2') { (ctx as RowCtx).setEditing(true); return true }
          return !t.pending && !e.metaKey && !e.ctrlKey && !e.altKey && taskShortcut(e, t.id, e.currentTarget, team, meId, () => toggleSelect(t.id))
        }}
        empty="No tasks with this status."
      />
    </div>
  )
}

type RowCtx = { editing: boolean; setEditing: (on: boolean) => void }
// Per row: whether its title is being renamed (F2 or ✎).
function useRowCtx(): RowCtx {
  const [editing, setEditing] = useState(false)
  return { editing, setEditing }
}

function TitleCell({ task, row }: { task: CalTask; row: RowCtx }) {
  const location = useLocation()
  const parentKey = useParentKey(task.parentTaskId)
  const workflow = useWorkflow()
  const done = workflow.isDone(task.status)
  if (row.editing) return <TitleEditor task={task} onDone={() => row.setEditing(false)} />
  return (
    <span className="cal-title-cell">
      {parentKey && <span className="cal-parent-chip" title={`Subtask of ${parentKey}`}>↳ {parentKey}</span>}
      {task.pending ? <span className="cal-title-link">{task.title}</span> : <Link className="cal-title-link" to={taskPath(location.pathname, task.taskKey)} state={{ taskListSearch: location.search }} title="View task">
        {task.title}
      </Link>}
      <button type="button" className="cal-icon-btn cal-rename-btn" disabled={task.pending} aria-label={`Rename ${task.taskKey}`} title="Rename (F2)" onClick={() => row.setEditing(true)}>✎</button>
      {task.blocked && !done && <span className="cal-table-blocked" title={task.blocked.reason}>Blocked</span>}
    </span>
  )
}

function DueLabel({ task }: { task: CalTask }) {
  const workflow = useWorkflow()
  const overdue = isUrgent(task, 'overdue', { today: todayKey(), now: Date.now(), isDone: workflow.isDone })
  return <span data-overdue={overdue || undefined}>{task.dueDate ? shortDate(task.dueDate) : '—'}</span>
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
