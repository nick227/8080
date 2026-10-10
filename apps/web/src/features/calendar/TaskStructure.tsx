import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { checklistApi, keys, useTaskChecklist, type ChecklistItem } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { Avatar } from './BoardView'
import { openField } from './actions'
import { useCalendar, useWorkflow } from './store'
import type { CalTask } from './types'

// Structure inside a task: its parent (if it is a subtask), its subtasks (real
// tasks, edited through the shared picker), and its checklist (small steps).


function useOpenTicket() {
  const navigate = useNavigate()
  const location = useLocation()
  return (taskKey: string) => {
    const next = new URLSearchParams(location.search)
    next.set('ticket', taskKey)
    navigate({ search: next.toString() })
  }
}

/** "Subtask of VC-12 …" with a way back to the parent, and to make it standalone. */
export function ParentLink({ task }: { task: CalTask }) {
  const parent = useCalendar((s) => (task.parentTaskId ? s.tasks.find((t) => t.id === task.parentTaskId) ?? null : null))
  const updateTask = useCalendar((s) => s.updateTask)
  const open = useOpenTicket()
  if (!task.parentTaskId) return null
  return (
    <div className="ticket-parent">
      <span>Subtask of</span>
      {parent ? <button type="button" className="cal-link-btn" onClick={() => open(parent.taskKey)}>{parent.taskKey} {parent.title}</button> : <span>a task you can't see</span>}
      <button type="button" className="cal-link-btn ticket-parent-detach" onClick={() => updateTask(task.id, { parentTaskId: null })}>Make standalone</button>
    </div>
  )
}

export function Subtasks({ task }: { task: CalTask }) {
  // Select the stable list, filter outside the selector (a new array per call loops in zustand).
  const all = useCalendar((s) => s.tasks)
  const children = useMemo(() => all.filter((t) => t.parentTaskId === task.id), [all, task.id])
  const add = useCalendar((s) => s.add)
  const workflow = useWorkflow()
  const open = useOpenTicket()
  const [text, setText] = useState('')
  // Subtasks can't have subtasks (one level).
  if (task.parentTaskId) return null
  const sorted = [...children].sort((a, b) => workflow.order(a.status) - workflow.order(b.status) || a.rank - b.rank)
  const done = children.filter((t) => workflow.isDone(t.status)).length
  const create = () => {
    const title = text.trim()
    if (!title || task.pending) return
    add({ title, parentTaskId: task.id, area: task.area ?? null })
    setText('')
  }
  return (
    <div className="ticket-section">
      <div className="ticket-activity-head">
        <h3 className="ticket-section-heading">Subtasks</h3>
        {children.length > 0 && <span className="ticket-progress-label">{done} of {children.length} done</span>}
      </div>
      {children.length > 0 && (
        <ul className="ticket-subtasks">
          {sorted.map((t) => (
            <li key={t.id} data-done={workflow.isDone(t.status) || undefined}>
              <span className="cal-ticket-key-tag">{t.taskKey}</span>
              <button type="button" className="cal-title-link" disabled={t.pending} onClick={() => open(t.taskKey)}>{t.title}</button>
              <button type="button" className="cal-cell ticket-subtask-status" disabled={t.pending} aria-label={`Status of ${t.taskKey}: ${workflow.label(t.status)}. Change`} onClick={(e) => openField('status', [t.id], e.currentTarget)}>
                {workflow.label(t.status)}
              </button>
              <button type="button" className="cal-chip" disabled={t.pending} aria-label={t.assigneeName ? `${t.taskKey} assigned to ${t.assigneeName}. Change` : `Assign ${t.taskKey}`} onClick={(e) => openField('assignee', [t.id], e.currentTarget)}>
                <Avatar name={t.assigneeName ?? null} url={t.assigneeAvatar ?? null} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="ticket-inline-add" onSubmit={(e) => { e.preventDefault(); create() }}>
        <input aria-label="New subtask" placeholder={task.pending ? 'Saving the task…' : 'Add a subtask'} maxLength={255} value={text} disabled={task.pending} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="cal-btn" disabled={!text.trim() || task.pending}>Add</button>
      </form>
    </div>
  )
}

export function Checklist({ task }: { task: CalTask }) {
  const { workspace } = useCurrentWorkspace()
  const ws = workspace?.id
  // Writes in flight: the list isn't refetched until they settle (a refetch in between
  // could return state from before a later write and undo what the person just did).
  const [busy, setBusy] = useState(0)
  const query = useTaskChecklist(ws, task.pending ? undefined : task.id, { paused: busy > 0 })
  const queryClient = useQueryClient()
  const say = useCalendar((s) => s.say)
  const [text, setText] = useState('')
  const addRef = useRef<HTMLInputElement>(null)
  const items = query.data ?? []
  const key = keys.taskChecklist(ws ?? '', task.id)

  /** Show the change now; the server's answer (and the live stream) confirm it. */
  const write = (optimistic: (list: ChecklistItem[]) => ChecklistItem[], run: () => Promise<unknown>) => {
    if (!ws) return
    void queryClient.cancelQueries({ queryKey: key })
    queryClient.setQueryData<ChecklistItem[]>(key, (list) => optimistic(list ?? []))
    setBusy((n) => n + 1)
    run()
      .catch((err) => say(`Couldn't update the checklist: ${err instanceof Error ? err.message : 'try again'}`))
      .finally(() => setBusy((n) => n - 1))
  }

  const add = () => {
    const clean = text.trim()
    if (!clean || !ws) return
    const temp: ChecklistItem = { id: `tmp-${crypto.randomUUID()}`, taskId: task.id, text: clean, done: false, position: Number.MAX_SAFE_INTEGER, doneAt: null, doneByName: null, createdAt: new Date().toISOString() }
    write((list) => [...list, temp], () => checklistApi.add(ws, task.id, { text: clean }))
    setText('')
    addRef.current?.focus()
  }
  const toggle = (item: ChecklistItem) =>
    write((list) => list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)), () => checklistApi.update(ws!, task.id, item.id, { done: !item.done }))
  const rename = (item: ChecklistItem, value: string) =>
    write((list) => list.map((i) => (i.id === item.id ? { ...i, text: value } : i)), () => checklistApi.update(ws!, task.id, item.id, { text: value }))
  const remove = (item: ChecklistItem) =>
    write((list) => list.filter((i) => i.id !== item.id), () => checklistApi.remove(ws!, task.id, item.id))
  const move = (item: ChecklistItem, step: -1 | 1) => {
    const at = items.findIndex((i) => i.id === item.id)
    const target = at + step
    if (target < 0 || target >= items.length) return
    const rest = items.filter((i) => i.id !== item.id)
    const next = [...rest.slice(0, target), item, ...rest.slice(target)]
    const above = next[target - 1]?.id ?? null
    const below = next[target + 1]?.id ?? null
    write(() => next, () => checklistApi.update(ws!, task.id, item.id, { afterItemId: above, beforeItemId: below }))
  }

  // When the last write settles, fetch once to take the server's word.
  useEffect(() => {
    if (busy === 0 && ws) void queryClient.invalidateQueries({ queryKey: key })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy === 0])

  const done = items.filter((i) => i.done).length
  return (
    <div className="ticket-section">
      <div className="ticket-activity-head">
        <h3 className="ticket-section-heading">Checklist</h3>
        {items.length > 0 && <span className="ticket-progress-label">{done} of {items.length}</span>}
      </div>
      {items.length > 0 && (
        <>
          <div className="ticket-progress" role="progressbar" aria-label="Checklist progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
            <span style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <ul className="ticket-checklist">
            {items.map((item) => <ChecklistRow key={item.id} item={item} onToggle={toggle} onRename={rename} onRemove={remove} onMove={move} />)}
          </ul>
        </>
      )}
      <form className="ticket-inline-add" onSubmit={(e) => { e.preventDefault(); add() }}>
        <input ref={addRef} aria-label="New checklist item" placeholder={task.pending ? 'Saving the task…' : 'Add a step'} maxLength={500} value={text} disabled={task.pending} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="cal-btn" disabled={!text.trim() || task.pending}>Add</button>
      </form>
    </div>
  )
}

function ChecklistRow({ item, onToggle, onRename, onRemove, onMove }: {
  item: ChecklistItem
  onToggle: (i: ChecklistItem) => void
  onRename: (i: ChecklistItem, text: string) => void
  onRemove: (i: ChecklistItem) => void
  onMove: (i: ChecklistItem, step: -1 | 1) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(item.text)
  const pending = item.id.startsWith('tmp-')
  const save = () => {
    const clean = value.trim()
    if (clean && clean !== item.text) onRename(item, clean)
    else setValue(item.text)
    setEditing(false)
  }
  return (
    <li data-done={item.done || undefined} data-pending={pending || undefined}
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
        e.preventDefault()
        onMove(item, e.key === 'ArrowUp' ? -1 : 1)
      }}>
      <input type="checkbox" checked={item.done} disabled={pending} aria-label={`Done: ${item.text}`} onChange={() => onToggle(item)} />
      {editing ? (
        <input className="ticket-checklist-edit" autoFocus aria-label={`Edit: ${item.text}`} maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save() }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setValue(item.text); setEditing(false) }
          }} />
      ) : (
        <button type="button" className="ticket-checklist-text" disabled={pending} title="Rename (Alt+↑/↓ to move)" onClick={() => setEditing(true)}>{item.text}</button>
      )}
      {item.done && item.doneByName && <span className="ticket-checklist-by">{item.doneByName}</span>}
      <button type="button" className="cal-icon-btn" disabled={pending} aria-label={`Remove: ${item.text}`} onClick={() => onRemove(item)}>×</button>
    </li>
  )
}
