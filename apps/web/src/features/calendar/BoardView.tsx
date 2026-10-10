import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTaskBoard, useUpdateTaskBoard, type WipLimits } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { todayKey } from './dates'
import { FIELDS, assignToMe, deleteTasks, openField, setField, targetsFor, taskShortcut } from './actions'
import { columnOf, useCalendar, useWorkflow, wf } from './store'
import { useTeam } from './sync'
import type { CalTask, TaskStatus } from './types'

// Done cards older than this fold away (Jira's Kanban does the same).
const DONE_FRESH_DAYS = 14

type Columns = Record<TaskStatus, string[]>

const TYPE_LABEL: Record<string, string> = { feature: 'Feature', bug: 'Bug', task: 'Task', story: 'Story', epic: 'Epic' }
const PRIORITY_MARK: Record<string, string> = { highest: '⇈', high: '↑', medium: '=', low: '↓' }
const statusTitle = (s: TaskStatus) => wf().label(s)

export function BoardView({
  tasks,
  onSelectTask,
  filtersOn,
  onClearFilters,
  createIn,
  onCreateHandled,
}: {
  tasks: CalTask[]
  onSelectTask: (task: CalTask) => void
  filtersOn: boolean
  onClearFilters: () => void
  /** Open the quick-create row of this column (keyboard shortcut `c`). */
  createIn: TaskStatus | null
  onCreateHandled: () => void
}) {
  const moveTask = useCalendar((s) => s.moveTask)
  const allTasks = useCalendar((s) => s.tasks)
  const say = useCalendar((s) => s.say)
  const { workspace } = useCurrentWorkspace()
  const board = useTaskBoard(workspace?.id)
  const limits: WipLimits = board.data?.wipLimits ?? {}
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin'
  const workflow = useWorkflow()
  // WIP counts every card in the column, whatever the filters show.
  const totals = useMemo(() => {
    const out = Object.fromEntries(workflow.active.map((s) => [s.key, 0])) as Record<TaskStatus, number>
    for (const t of allTasks) out[t.status] = (out[t.status] ?? 0) + 1
    return out
  }, [allTasks, workflow])
  // Say so when a column goes over its limit (by anyone's move); limits are soft.
  const prevTotals = useRef<Record<TaskStatus, number> | null>(null)
  useEffect(() => {
    const prev = prevTotals.current
    prevTotals.current = totals
    if (!prev) return
    for (const { key, label } of workflow.active) {
      const limit = limits[key]
      if (limit && (totals[key] ?? 0) > limit && (prev[key] ?? 0) <= limit) say(`${label} is over its WIP limit (${totals[key]} of ${limit})`)
    }
  }, [totals, limits, say, workflow])
  const [showOldDone, setShowOldDone] = useState(false)
  const [creating, setCreating] = useState<TaskStatus | null>(null)

  useEffect(() => {
    if (createIn) {
      setCreating(createIn)
      onCreateHandled()
    }
  }, [createIn, onCreateHandled])

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const cutoff = Date.now() - DONE_FRESH_DAYS * 86_400_000
  // Old done cards fold away in every done-category column.
  const oldDone = tasks.filter((t) => workflow.isDone(t.status) && t.resolvedAt && Date.parse(t.resolvedAt) < cutoff)
  const hidden = showOldDone ? new Set<string>() : new Set(oldDone.map((t) => t.id))

  const settled: Columns = useMemo(() => {
    const cols = {} as Columns
    for (const { key } of workflow.active) cols[key] = columnOf(tasks, key).filter((t) => !hidden.has(t.id)).map((t) => t.id)
    return cols
    // `hidden` is derived from tasks + showOldDone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, showOldDone, workflow])

  // While dragging, the board shows where the card would land.
  const [dragging, setDragging] = useState<{ id: string; from: TaskStatus; columns: Columns } | null>(null)
  const columns = dragging?.columns ?? settled
  const activeTask = dragging ? byId.get(dragging.id) ?? null : null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    // Space picks up and drops; Enter stays free to open the card.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  )

  const containerOf = (cols: Columns, id: string): TaskStatus | null =>
    (workflow.isActive(id) ? id : undefined) ?? (Object.keys(cols) as TaskStatus[]).find((s) => cols[s]!.includes(id)) ?? null

  const onDragStart = ({ active }: DragStartEvent) => {
    const from = containerOf(settled, String(active.id))
    if (from) setDragging({ id: String(active.id), from, columns: settled })
  }

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return
    const id = String(active.id)
    setDragging((state) => {
      if (!state) return state
      const from = containerOf(state.columns, id)
      const to = containerOf(state.columns, String(over.id))
      if (!from || !to || from === to) return state
      const target = state.columns[to]
      const overIndex = target.indexOf(String(over.id))
      const index = overIndex >= 0 ? overIndex : target.length
      return {
        ...state,
        columns: { ...state.columns, [from]: state.columns[from].filter((x) => x !== id), [to]: [...target.slice(0, index), id, ...target.slice(index)] },
      }
    })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const state = dragging
    setDragging(null)
    if (!state || !over) return
    const id = String(active.id)
    const to = containerOf(state.columns, id)
    if (!to) return
    let column = state.columns[to]
    const overIndex = column.indexOf(String(over.id))
    const from = column.indexOf(id)
    if (overIndex >= 0 && overIndex !== from) column = arrayMove(column, from, overIndex)
    const index = column.indexOf(id)
    const original = settled[state.from].indexOf(id)
    if (to === state.from && index === original) return
    moveTask(id, to, { afterTaskId: column[index - 1] ?? null, beforeTaskId: column[index + 1] ?? null })
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${label(byId.get(String(active.id)))}.`,
    onDragOver: ({ active, over }) => (over ? `${label(byId.get(String(active.id)))} is over ${where(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `${label(byId.get(String(active.id)))} dropped in ${where(over.id)}.` : 'Dropped.'),
    onDragCancel: ({ active }) => `Cancelled. ${label(byId.get(String(active.id)))} is back where it was.`,
  }
  const where = (overId: string | number) => {
    const status = containerOf(columns, String(overId))
    return status ? statusTitle(status) : 'the board'
  }

  const empty = tasks.length === 0

  return (
    <div className="cal-board-view" role="region" aria-label="Board">
      {empty && filtersOn && (
        <p className="cal-board-note" role="status">
          No tasks match these filters. <button type="button" className="cal-link-btn" onClick={onClearFilters}>Clear filters</button>
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: 'Press Space to pick up the card. Use the arrow keys to move it, Space to drop it, Escape to cancel. Press Enter to open it.' },
        }}
      >
        <div className="cal-kanban-grid">
          {workflow.active.map((col) => (
            <Column
              key={col.key}
              status={col.key}
              title={col.label}
              ids={columns[col.key] ?? []}
              byId={byId}
              creating={creating === col.key}
              onCreating={(on) => setCreating(on ? col.key : null)}
              onSelectTask={onSelectTask}
              total={totals[col.key] ?? 0}
              limit={limits[col.key] ?? null}
              canManage={canManage}
              workspaceId={workspace?.id ?? ''}
              limits={limits}
              footer={col.key === workflow.firstDone && oldDone.length > 0 ? (
                <button type="button" className="cal-link-btn cal-kanban-more" onClick={() => setShowOldDone((v) => !v)}>
                  {showOldDone ? `Hide ${oldDone.length} done over ${DONE_FRESH_DAYS} days ago` : `Show ${oldDone.length} older done`}
                </button>
              ) : null}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>
          {activeTask ? <CardBody task={activeTask} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

const label = (t: CalTask | undefined) => (t ? `${t.taskKey} ${t.title}` : 'card')

// The card a Shift-click range starts from.
let anchorId: string | null = null

/** Toggle one card, or (Shift) select the range from the last card picked in the same column. */
function selectCard(id: string, columnIds: string[], range: boolean) {
  const s = useCalendar.getState()
  const from = anchorId ? columnIds.indexOf(anchorId) : -1
  const to = columnIds.indexOf(id)
  if (range && from >= 0 && to >= 0) {
    s.selectMany(columnIds.slice(Math.min(from, to), Math.max(from, to) + 1), true)
  } else {
    s.toggleSelect(id)
  }
  anchorId = id
}

function Column({
  status,
  title,
  ids,
  byId,
  creating,
  onCreating,
  onSelectTask,
  total,
  limit,
  canManage,
  workspaceId,
  limits,
  footer,
}: {
  status: TaskStatus
  title: string
  ids: string[]
  byId: Map<string, CalTask>
  creating: boolean
  onCreating: (on: boolean) => void
  onSelectTask: (task: CalTask) => void
  total: number
  limit: number | null
  canManage: boolean
  workspaceId: string
  limits: WipLimits
  footer: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const cards = useMemo(() => ids.map((id) => byId.get(id)).filter((t): t is CalTask => !!t), [ids, byId])
  const cardIds = useMemo(() => cards.map((c) => c.id), [cards])
  const points = cards.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0)
  const blocked = cards.filter((t) => t.blocked).length
  const [editing, setEditing] = useState(false)
  const wip = limit == null ? undefined : total > limit ? 'over' : total === limit ? 'at' : 'under'

  return (
    <section
      className="cal-kanban-column"
      data-status={status}
      data-over={isOver || undefined}
      data-wip={wip}
      aria-label={`${title}, ${cards.length} tasks${limit != null ? `, WIP limit ${limit}${wip === 'over' ? ', over the limit' : ''}` : ''}`}
    >
      <header className="cal-kanban-header">
        <div className="cal-kanban-title-group">
          <h3 className="cal-kanban-title">{title}</h3>
          {limit != null
            ? <span className="cal-kanban-count cal-wip" title={`WIP limit ${limit}: ${total} in this column${total !== cards.length ? `, ${cards.length} shown` : ''}`}>{total}/{limit}</span>
            : <span className="cal-kanban-count">{cards.length}</span>}
          {points > 0 && <span className="cal-kanban-points">{points} pts</span>}
          {blocked > 0 && !wf().isDone(status) && <span className="cal-kanban-blocked">{blocked} blocked</span>}
        </div>
        <div className="cal-kanban-tools">
          {canManage && (
            <button type="button" className="cal-icon-btn cal-wip-btn" aria-label={`WIP limit for ${title}`} aria-expanded={editing} title="Set WIP limit" onClick={() => setEditing((v) => !v)}>⚑</button>
          )}
          <button type="button" className="cal-icon-btn" aria-label={`Create a task in ${title}`} title={`Create in ${title}`} onClick={() => onCreating(true)}>+</button>
        </div>
      </header>
      {editing && <WipEditor status={status} title={title} limit={limit} limits={limits} workspaceId={workspaceId} onDone={() => setEditing(false)} />}

      <SortableContext id={status} items={ids} strategy={verticalListSortingStrategy}>
        <ol ref={setNodeRef} className="cal-kanban-cards">
          {cards.map((task) => <SortableCard key={task.id} task={task} onOpen={() => onSelectTask(task)} onSelect={(e) => selectCard(task.id, cardIds, e.shiftKey)} />)}
          {cards.length === 0 && !creating && <li className="cal-kanban-empty">Drop tasks here</li>}
        </ol>
      </SortableContext>

      {creating ? <QuickCreate status={status} title={title} lastId={ids.at(-1) ?? null} onDone={() => onCreating(false)} />
        : <button type="button" className="cal-kanban-create" onClick={() => onCreating(true)}>+ Create</button>}
      {footer}
    </section>
  )
}

function WipEditor({ status, title, limit, limits, workspaceId, onDone }: { status: TaskStatus; title: string; limit: number | null; limits: WipLimits; workspaceId: string; onDone: () => void }) {
  const update = useUpdateTaskBoard(workspaceId)
  const [value, setValue] = useState(limit != null ? String(limit) : '')
  const save = (next: number | null) => {
    const wipLimits: WipLimits = { ...limits, [status]: next }
    for (const key of Object.keys(wipLimits) as (keyof WipLimits)[]) if (wipLimits[key] == null) delete wipLimits[key]
    update.mutate({ wipLimits }, { onSuccess: onDone })
  }
  const parsed = Number(value)
  const valid = value.trim() !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 999
  return (
    <form className="cal-wip-editor" onSubmit={(e) => { e.preventDefault(); if (valid) save(parsed) }}>
      <label>
        <span>Max cards in {title}</span>
        <input type="number" min={1} max={999} step={1} autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onDone() }} />
      </label>
      <div className="cal-wip-actions">
        <button type="submit" className="cal-btn" data-primary="" disabled={!valid || update.isPending}>Save</button>
        {limit != null && <button type="button" className="cal-btn" disabled={update.isPending} onClick={() => save(null)}>No limit</button>}
        <button type="button" className="cal-link-btn" onClick={onDone}>Cancel</button>
      </div>
      {update.isError && <p role="alert">Couldn't save the limit: {(update.error as Error).message}</p>}
    </form>
  )
}

function QuickCreate({ status, title, lastId, onDone }: { status: TaskStatus; title: string; lastId: string | null; onDone: () => void }) {
  const add = useCalendar((s) => s.add)
  const members = useCalendar((s) => s.filters.members)
  const { team } = useTeam()
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])

  // Filtering by one person: new cards go to them, so they stay visible.
  const assignee = members.length === 1 ? team.find((m) => m.id === members[0]) ?? null : null

  const create = () => {
    const clean = text.trim()
    if (!clean) return
    add({ title: clean, status, afterTaskId: lastId, assigneeId: assignee?.id ?? null, assigneeName: assignee?.name ?? null, assigneeAvatar: assignee?.avatarUrl ?? null })
    setText('')
  }

  return (
    <div className="cal-kanban-quick">
      <textarea
        ref={ref}
        rows={2}
        value={text}
        aria-label={`New task in ${title}`}
        placeholder="What needs to be done?"
        maxLength={255}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            create()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onDone()
          }
        }}
        onBlur={() => { if (!text.trim()) onDone() }}
      />
      <div className="cal-kanban-quick-actions">
        <span>{assignee ? `Assigned to ${assignee.name} · ` : ''}Enter to add, Esc to close</span>
        <button type="button" className="cal-btn" data-primary="" onMouseDown={(e) => e.preventDefault()} onClick={create} disabled={!text.trim()}>Add</button>
      </div>
    </div>
  )
}

function SortableCard({ task, onOpen, onSelect }: { task: CalTask; onOpen: () => void; onSelect: (e: React.MouseEvent | React.KeyboardEvent) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !!task.pending })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const selected = useCalendar((s) => s.selection.includes(task.id))
  const selecting = useCalendar((s) => s.selection.length > 0)
  const done = useWorkflow().isDone(task.status)
  const { team, meId } = useTeam()
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="cal-kanban-slot"
      data-dragging={isDragging || undefined}
      data-selected={selected || undefined}
    >
      <div
        {...attributes}
        {...listeners}
        className="cal-kanban-card"
        aria-roledescription="Draggable task"
        aria-label={`${task.taskKey} ${task.title}${task.blocked ? `, blocked: ${task.blocked.reason}` : ''}${selected ? ', selected' : ''}`}
        data-done={done || undefined}
        data-pending={task.pending || undefined}
        data-blocked={(task.blocked && !done) || undefined}
        data-task-id={task.id}
        onClick={(e) => {
          // Ctrl/⌘-click and Shift-click select; a plain click opens.
          if (e.metaKey || e.ctrlKey || e.shiftKey || selecting) onSelect(e)
          else onOpen()
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter') {
            e.preventDefault()
            onOpen()
            return
          }
          if (!task.pending && !e.metaKey && !e.ctrlKey && !e.altKey && taskShortcut(e, task.id, e.currentTarget, team, meId, () => onSelect(e))) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          listeners?.onKeyDown?.(e)
        }}
      >
        <CardBody task={task} interactive />
      </div>
      <label className="cal-card-check" data-shown={selecting || undefined} onPointerDown={(e) => e.stopPropagation()}>
        <input type="checkbox" aria-label={`Select ${task.taskKey}`} checked={selected} disabled={task.pending} onChange={() => useCalendar.getState().toggleSelect(task.id)} />
      </label>
      <CardMenu task={task} />
    </li>
  )
}

/** A chip on a card that edits one field in place (doesn't drag or open the card). */
function Chip({ task, field, label, className, children }: { task: CalTask; field: Parameters<typeof openField>[0]; label: string; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`cal-chip ${className ?? ''}`}
      aria-label={label}
      title={label}
      disabled={task.pending}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        openField(field, targetsFor(task.id), e.currentTarget)
      }}
    >
      {children}
    </button>
  )
}

/** "1/3": done subtasks of a parent (a primitive, so the card only re-renders when it changes). */
export function useSubtaskProgress(taskId: string) {
  return useCalendar((s) => {
    let total = 0
    let done = 0
    for (let i = 0; i < s.tasks.length; i++) {
      const t = s.tasks[i]!
      if (t.parentTaskId === taskId) {
        total++
        if (wf().isDone(t.status)) done++
      }
    }
    return total > 0 ? `${done}/${total}` : ''
  })
}

export function useParentKey(parentTaskId: string | null | undefined) {
  return useCalendar((s) => {
    if (!parentTaskId) return null
    for (let i = 0; i < s.tasks.length; i++) {
      const t = s.tasks[i]!
      if (t.id === parentTaskId) return t.taskKey
    }
    return null
  })
}

function CardBody({ task, overlay, interactive }: { task: CalTask; overlay?: boolean; interactive?: boolean }) {
  const subtasks = useSubtaskProgress(task.id)
  const parentKey = useParentKey(task.parentTaskId)
  const today = todayKey()
  const isDone = useWorkflow().isDone(task.status)
  const overdue = !!task.dueDate && task.dueDate < today && !isDone
  return (
    <div className="cal-card-body" data-overlay={overlay || undefined}>
      <div className="cal-card-top-row">
        <span className="cal-ticket-key-tag">{task.taskKey}</span>
        <span className="cal-type-tag" data-type={task.category ?? 'task'}>{TYPE_LABEL[task.category ?? 'task']}</span>
        {task.area && <span className="cal-area-chip">{task.area}</span>}
        {parentKey && <span className="cal-parent-chip" title={`Subtask of ${parentKey}`}>↳ {parentKey}</span>}
      </div>
      <h4 className="cal-card-title">{task.title}</h4>
      {task.blocked && !isDone && (
        <p className="cal-card-blocked" title={`Blocked ${since(task.blocked.since)}${task.blocked.byName ? ` by ${task.blocked.byName}` : ''}`}>
          <strong>Blocked</strong> {task.blocked.reason}
        </p>
      )}
      <div className="cal-card-bottom-row">
        {interactive ? (
          <Chip task={task} field="priority" label={`Priority: ${task.priority ?? 'medium'}. Change`} className="cal-priority-mark" >
            <span data-priority={task.priority ?? 'medium'}>{PRIORITY_MARK[task.priority ?? 'medium'] ?? '='}</span>
          </Chip>
        ) : task.priority && task.priority !== 'medium' && (
          <span className="cal-priority-mark" data-priority={task.priority}>{PRIORITY_MARK[task.priority]}</span>
        )}
        {task.dueDate ? (
          interactive
            ? <Chip task={task} field="due" label={`Due ${task.dueDate}. Change`} className="cal-card-due"><span data-overdue={overdue || undefined}>{overdue ? 'Overdue ' : 'Due '}{shortDate(task.dueDate)}</span></Chip>
            : <span className="cal-card-due" data-overdue={overdue || undefined}>{overdue ? 'Overdue ' : 'Due '}{shortDate(task.dueDate)}</span>
        ) : interactive && <Chip task={task} field="due" label="Set a due date" className="cal-card-due cal-chip-ghost"><span>+ Due</span></Chip>}
        {task.day && <span className="cal-card-due">{shortDate(task.day)}{task.time ? ` ${task.time}` : ''}</span>}
        {task.commentCount > 0 && <span className="cal-card-comments" title={`${task.commentCount} comments`}>{task.commentCount} ✎</span>}
        {subtasks && <span className="cal-card-progress" title={`Subtasks done: ${subtasks}`}>◫ {subtasks}</span>}
        {!!task.checklist?.total && (
          <span className="cal-card-progress" data-complete={task.checklist.done === task.checklist.total || undefined} title={`Checklist: ${task.checklist.done} of ${task.checklist.total} done`}>
            ☑ {task.checklist.done}/{task.checklist.total}
          </span>
        )}
        <span className="cal-card-right-tags">
          {task.storyPoints != null && <span className="cal-points-badge" title={`${task.storyPoints} story points`}>{task.storyPoints}</span>}
          {interactive
            ? <Chip task={task} field="assignee" label={task.assigneeName ? `Assigned to ${task.assigneeName}. Change` : 'Assign'}><Avatar name={task.assigneeName ?? null} url={task.assigneeAvatar ?? null} /></Chip>
            : <Avatar name={task.assigneeName ?? null} url={task.assigneeAvatar ?? null} />}
        </span>
      </div>
    </div>
  )
}

export function Avatar({ name, url }: { name: string | null; url: string | null }) {
  if (!name) return <span className="cal-avatar" data-empty="" title="Unassigned" aria-label="Unassigned" />
  return url
    ? <img className="cal-avatar" src={url} alt={name} title={name} />
    : <span className="cal-avatar" title={name} aria-label={name}>{initials(name)}</span>
}

/** "2d", "3h", "just now": how long something has been true. */
export function since(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  if (mins < 1440) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / 1440)}d`
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

function shortDate(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function CardMenu({ task }: { task: CalTask }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const moveTask = useCalendar((s) => s.moveTask)
  const tasks = useCalendar((s) => s.tasks)
  const say = useCalendar((s) => s.say)
  const selection = useCalendar((s) => s.selection)
  const { team, meId } = useTeam()
  // On a selected card, the menu acts on the whole selection.
  const ids = selection.includes(task.id) ? selection : [task.id]
  const me = team.find((m) => m.id === meId)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const run = (fn: () => void) => () => { setOpen(false); fn() }
  const column = columnOf(tasks, task.status)
  const first = column[0]
  const last = column.at(-1)

  return (
    <div className="cal-card-menu" ref={ref}>
      <button
        type="button"
        className="cal-icon-btn"
        aria-label={`Actions for ${task.taskKey}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={task.pending}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="cal-menu" role="menu" aria-label={`Actions for ${task.taskKey}`} onKeyDown={(e) => menuKeys(e)}>
          <span className="cal-menu-heading">{ids.length > 1 ? `${ids.length} selected · move to` : 'Move to'}</span>
          {wf().active.filter((st) => ids.length > 1 || st.key !== task.status).map((st) => (
            <button key={st.key} type="button" role="menuitem" onClick={run(() => setField(ids, 'status', st.key, team))}>{st.label}</button>
          ))}
          {ids.length === 1 && first && first.id !== task.id && <button type="button" role="menuitem" onClick={run(() => moveTask(task.id, task.status, { beforeTaskId: first.id }))}>Top of column</button>}
          {ids.length === 1 && last && last.id !== task.id && <button type="button" role="menuitem" onClick={run(() => moveTask(task.id, task.status, { afterTaskId: last.id }))}>Bottom of column</button>}
          <hr />
          {(['assignee', 'priority', 'due', 'type', 'points'] as const).map((f) => (
            <button key={f} type="button" role="menuitem" onClick={(e) => { const at = e.currentTarget.closest('.cal-card-menu'); setOpen(false); openField(f, ids, at) }}>
              {FIELDS[f].label}…<kbd>{FIELDS[f].key.toUpperCase()}</kbd>
            </button>
          ))}
          {ids.every((id) => tasks.find((t) => t.id === id)?.blocked)
            ? <button type="button" role="menuitem" onClick={run(() => setField(ids, 'blocked', null, team))}>Unblock</button>
            : <button type="button" role="menuitem" onClick={(e) => { const at = e.currentTarget.closest('.cal-card-menu'); setOpen(false); openField('blocked', ids, at) }}>Mark blocked…<kbd>B</kbd></button>}
          {me && ids.some((id) => tasks.find((t) => t.id === id)?.assigneeId !== me.id) && (
            <button type="button" role="menuitem" onClick={run(() => assignToMe(ids, team, meId))}>Assign to me<kbd>I</kbd></button>
          )}
          {ids.length === 1 && task.assigneeId && <button type="button" role="menuitem" onClick={run(() => setField(ids, 'assignee', '', team))}>Unassign</button>}
          {ids.length === 1 && (
            <button
              type="button"
              role="menuitem"
              onClick={run(() => {
                const url = `${window.location.origin}${window.location.pathname}?desk=calendar&ticket=${task.taskKey}`
                void navigator.clipboard.writeText(url).then(() => say(`Copied the link to ${task.taskKey}`), () => say('Couldn\u2019t copy the link'))
              })}
            >
              Copy link
            </button>
          )}
          <hr />
          <button type="button" role="menuitem" data-danger="" onClick={run(() => deleteTasks(ids))}>{ids.length > 1 ? `Delete ${ids.length}` : 'Delete'}</button>
        </div>
      )}
    </div>
  )
}

function menuKeys(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  const at = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
  items[next]?.focus()
}
