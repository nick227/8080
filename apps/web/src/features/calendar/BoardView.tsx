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
import { columnOf, useCalendar } from './store'
import { useTeam } from './sync'
import { STATUSES, type CalTask, type TaskStatus } from './types'

// Done cards older than this fold away (Jira's Kanban does the same).
const DONE_FRESH_DAYS = 14

type Columns = Record<TaskStatus, string[]>

const TYPE_LABEL: Record<string, string> = { feature: 'Feature', bug: 'Bug', task: 'Task', story: 'Story', epic: 'Epic' }
const PRIORITY_MARK: Record<string, string> = { highest: '⇈', high: '↑', low: '↓' }
const statusTitle = (s: TaskStatus) => STATUSES.find((c) => c.id === s)!.title

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
  // WIP counts every card in the column, whatever the filters show.
  const totals = useMemo(() => {
    const out = { open: 0, in_progress: 0, in_review: 0, done: 0 } as Record<TaskStatus, number>
    for (const t of allTasks) out[t.status]++
    return out
  }, [allTasks])
  // Say so when a column goes over its limit (by anyone's move); limits are soft.
  const prevTotals = useRef<Record<TaskStatus, number> | null>(null)
  useEffect(() => {
    const prev = prevTotals.current
    prevTotals.current = totals
    if (!prev) return
    for (const { id, title } of STATUSES) {
      const limit = limits[id]
      if (limit && totals[id] > limit && prev[id] <= limit) say(`${title} is over its WIP limit (${totals[id]} of ${limit})`)
    }
  }, [totals, limits, say])
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
  const oldDone = tasks.filter((t) => t.status === 'done' && t.resolvedAt && Date.parse(t.resolvedAt) < cutoff)
  const hidden = showOldDone ? new Set<string>() : new Set(oldDone.map((t) => t.id))

  const settled: Columns = useMemo(() => {
    const cols = {} as Columns
    for (const { id } of STATUSES) cols[id] = columnOf(tasks, id).filter((t) => !hidden.has(t.id)).map((t) => t.id)
    return cols
    // `hidden` is derived from tasks + showOldDone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, showOldDone])

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
    (STATUSES.find((s) => s.id === id)?.id as TaskStatus | undefined) ?? (Object.keys(cols) as TaskStatus[]).find((s) => cols[s].includes(id)) ?? null

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
          {STATUSES.map((col) => (
            <Column
              key={col.id}
              status={col.id}
              title={col.title}
              ids={columns[col.id]}
              byId={byId}
              creating={creating === col.id}
              onCreating={(on) => setCreating(on ? col.id : null)}
              onSelectTask={onSelectTask}
              total={totals[col.id]}
              limit={limits[col.id] ?? null}
              canManage={canManage}
              workspaceId={workspace?.id ?? ''}
              limits={limits}
              footer={col.id === 'done' && oldDone.length > 0 ? (
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
  const cards = ids.map((id) => byId.get(id)).filter((t): t is CalTask => !!t)
  const points = cards.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0)
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
          {cards.map((task) => <SortableCard key={task.id} task={task} onOpen={() => onSelectTask(task)} />)}
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

function SortableCard({ task, onOpen }: { task: CalTask; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !!task.pending })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="cal-kanban-slot"
      data-dragging={isDragging || undefined}
    >
      <div
        {...attributes}
        {...listeners}
        className="cal-kanban-card"
        aria-roledescription="Draggable task"
        aria-label={`${task.taskKey} ${task.title}`}
        data-done={task.status === 'done' || undefined}
        data-pending={task.pending || undefined}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) {
            e.preventDefault()
            onOpen()
            return
          }
          listeners?.onKeyDown?.(e)
        }}
      >
        <CardBody task={task} />
      </div>
      <CardMenu task={task} />
    </li>
  )
}

function CardBody({ task, overlay }: { task: CalTask; overlay?: boolean }) {
  const today = todayKey()
  const overdue = !!task.dueDate && task.dueDate < today && task.status !== 'done'
  return (
    <div className="cal-card-body" data-overlay={overlay || undefined}>
      <div className="cal-card-top-row">
        <span className="cal-ticket-key-tag">{task.taskKey}</span>
        <span className="cal-type-tag" data-type={task.category ?? 'task'}>{TYPE_LABEL[task.category ?? 'task']}</span>
        {task.area && <span className="cal-area-chip">{task.area}</span>}
      </div>
      <h4 className="cal-card-title">{task.title}</h4>
      <div className="cal-card-bottom-row">
        {task.priority && task.priority !== 'medium' && (
          <span className="cal-priority-mark" data-priority={task.priority} title={`Priority: ${task.priority}`} aria-label={`Priority ${task.priority}`}>
            {PRIORITY_MARK[task.priority]}
          </span>
        )}
        {task.dueDate && <span className="cal-card-due" data-overdue={overdue || undefined}>{overdue ? 'Overdue ' : 'Due '}{shortDate(task.dueDate)}</span>}
        {task.day && <span className="cal-card-due">{shortDate(task.day)}{task.time ? ` ${task.time}` : ''}</span>}
        {task.commentCount > 0 && <span className="cal-card-comments" title={`${task.commentCount} comments`}>{task.commentCount} ✎</span>}
        <span className="cal-card-right-tags">
          {task.storyPoints != null && <span className="cal-points-badge" title={`${task.storyPoints} story points`}>{task.storyPoints}</span>}
          <Avatar name={task.assigneeName ?? null} url={task.assigneeAvatar ?? null} />
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
  const updateTask = useCalendar((s) => s.updateTask)
  const remove = useCalendar((s) => s.remove)
  const say = useCalendar((s) => s.say)
  const { team, meId } = useTeam()
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
          <span className="cal-menu-heading">Move to</span>
          {STATUSES.filter((s) => s.id !== task.status).map((s) => (
            <button key={s.id} type="button" role="menuitem" onClick={run(() => moveTask(task.id, s.id, {}))}>{s.title}</button>
          ))}
          {first && first.id !== task.id && <button type="button" role="menuitem" onClick={run(() => moveTask(task.id, task.status, { beforeTaskId: first.id }))}>Top of column</button>}
          {last && last.id !== task.id && <button type="button" role="menuitem" onClick={run(() => moveTask(task.id, task.status, { afterTaskId: last.id }))}>Bottom of column</button>}
          <hr />
          {me && task.assigneeId !== me.id && (
            <button type="button" role="menuitem" onClick={run(() => updateTask(task.id, { assigneeId: me.id, assigneeName: me.name, assigneeAvatar: me.avatarUrl ?? null }))}>Assign to me</button>
          )}
          {task.assigneeId && <button type="button" role="menuitem" onClick={run(() => updateTask(task.id, { assigneeId: null, assigneeName: null, assigneeAvatar: null }))}>Unassign</button>}
          <button
            type="button"
            role="menuitem"
            onClick={run(() => {
              const url = `${window.location.origin}${window.location.pathname}?desk=calendar&ticket=${task.taskKey}`
              void navigator.clipboard.writeText(url).then(() => say(`Copied the link to ${task.taskKey}`), () => say('Couldn’t copy the link'))
            })}
          >
            Copy link
          </button>
          <hr />
          <button type="button" role="menuitem" data-danger="" onClick={run(() => remove(task.id))}>Delete</button>
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
