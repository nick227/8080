import { useEffect, useRef, useState } from 'react'
import { HOURS, hourLabel } from './dates'
import type { CalTask, CalAccomplishment } from './types'
import { wf } from './store'
import { WorkEntryChip } from './WorkEntryChip'

export function DayView({
  day,
  today,
  tasks,
  accomplishments = [],
  composing,
  onComposeEnd,
  onAdd,
  onToggle,
  onRemove,
  onSelectTask,
}: {
  day: string
  today: string
  tasks: CalTask[]
  accomplishments?: CalAccomplishment[]
  composing?: boolean
  onComposeEnd?: () => void
  onAdd: (title: string, time: string | null) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onSelectTask?: (task: CalTask) => void
}) {
  const planRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const untimed = tasks.filter((task) => !task.time)
  const byHour = new Map<string, CalTask[]>()
  for (const task of tasks) {
    if (!task.time) continue
    const key = `${task.time.slice(0, 2)}:00`
    const list = byHour.get(key)
    if (list) list.push(task)
    else byHour.set(key, [task])
  }
  for (const list of byHour.values()) list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  const now = `${String(new Date().getHours()).padStart(2, '0')}:00`

  useEffect(() => {
    const root = planRef.current
    if (!root) return
    const anchor = root.querySelector('[data-has]') ?? root.querySelector(day === today ? '[data-now]' : '[data-hour="08:00"]')
    if (!(anchor instanceof HTMLElement)) return
    const top = anchor.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
    root.scrollTop = top
  }, [day, today])

  useEffect(() => {
    const root = planRef.current
    if (!editing || !root) return
    const slot = root.querySelector(`[data-hour="${editing}"]`)
    if (!(slot instanceof HTMLElement)) return
    const rootBox = root.getBoundingClientRect()
    const box = slot.getBoundingClientRect()
    if (box.top < rootBox.top) root.scrollTop += box.top - rootBox.top
    else if (box.bottom > rootBox.bottom) root.scrollTop += box.bottom - rootBox.bottom
  }, [editing])

  const stepHour = (from: string | null, delta: number) => {
    if (!from) {
      const edge = delta > 0 ? HOURS[0] : HOURS[HOURS.length - 1]
      setEditing(edge.value)
      return
    }
    const next = HOURS[HOURS.findIndex((hour) => hour.value === from) + delta]
    if (next) setEditing(next.value)
  }

  const dayAccs = accomplishments.filter((a) => a.day === day)

  return (
    <div
      className="cal-plan"
      ref={planRef}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Tab') return
        if (event.target instanceof HTMLInputElement) return
        event.preventDefault()
        const host = event.target instanceof HTMLElement ? event.target : null
        const slot = host ? host.closest('[data-hour]') : null
        stepHour(slot ? slot.getAttribute('data-hour') : null, event.shiftKey ? -1 : 1)
      }}
    >

      {/* Accomplishments / Work Log Banner */}
      {dayAccs.length > 0 && (
        <section className="cal-day-accomplishments-banner">
          <h4>Completed</h4>
          <div className="cal-day-acc-list">
            {dayAccs.map((acc) => (
              <WorkEntryChip key={acc.id} entry={acc} />
            ))}
          </div>
        </section>
      )}

      {untimed.length > 0 && (
        <section className="cal-slot" data-has="">
          <span className="cal-hour">Any</span>
          <div className="cal-slot-tasks">
            {untimed.map((task) => (
              <TaskLine
                key={task.id}
                task={task}
                onToggle={onToggle}
                onRemove={onRemove}
                onSelectTask={onSelectTask}
              />
            ))}
          </div>
        </section>
      )}

      {(composing || editing === 'untimed') && (
        <section className="cal-slot" data-has="">
          <span className="cal-hour">Any</span>
          <div className="cal-slot-tasks">
            <UntimedAdd
              onAdd={(title) => {
                onAdd(title, null)
                setEditing(null)
              }}
              onClose={() => {
                setEditing(null)
                onComposeEnd?.()
              }}
            />
          </div>
        </section>
      )}

      {HOURS.map((hour, index) => {
        const rows = byHour.get(hour.value) ?? []
        return (
          <section
            key={hour.value}
            className="cal-slot"
            data-hour={hour.value}
            data-now={day === today && hour.value === now ? '' : undefined}
            data-has={rows.length ? '' : undefined}
          >
            <time className="cal-hour" dateTime={hour.value}>{hour.label}</time>
            <div className="cal-slot-tasks">
              {rows.map((task) => (
                <TaskLine
                  key={task.id}
                  task={task}
                  showTime={task.time !== hour.value}
                  onToggle={onToggle}
                  onRemove={onRemove}
                  onSelectTask={onSelectTask}
                />
              ))}
              <HourAdd
                label={hour.label}
                editing={editing === hour.value}
                onOpen={() => setEditing(hour.value)}
                onClose={() => setEditing((current) => current === hour.value ? null : current)}
                onAdd={(title) => onAdd(title, hour.value)}
                onStep={(delta) => {
                  const next = HOURS[index + delta]
                  setEditing(next ? next.value : null)
                }}
              />
            </div>
          </section>
        )
      })}
    </div>
  )
}

function UntimedAdd({ onAdd, onClose }: { onAdd: (title: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    done.current = false
    setTitle('')
    inputRef.current?.focus()
  }, [])

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const next = (inputRef.current?.value ?? title).trim()
    if (save && next) onAdd(next)
    onClose()
  }

  return (
    <form className="cal-slot-add" onSubmit={(event) => { event.preventDefault(); finish(true) }}>
      <span className="cal-plus" aria-hidden="true">+</span>
      <input
        ref={inputRef}
        value={title}
        aria-label="New ticket"
        placeholder="Ticket summary..."
        autoComplete="off"
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); finish(true) }
          if (event.key === 'Escape') { event.preventDefault(); finish(false) }
        }}
      />
    </form>
  )
}

function HourAdd({ label, editing, onOpen, onClose, onAdd, onStep }: {
  label: string
  editing: boolean
  onOpen: () => void
  onClose: () => void
  onAdd: (title: string) => void
  onStep: (delta: number) => void
}) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    if (!editing) return
    done.current = false
    setTitle('')
    inputRef.current?.focus()
  }, [editing])

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const next = (inputRef.current?.value ?? title).trim()
    if (save && next) onAdd(next)
    onClose()
  }

  if (!editing) {
    return (
      <button type="button" className="cal-slot-add" aria-label={`Add a ticket at ${label}`} onClick={onOpen}>
        <span className="cal-plus" aria-hidden="true">+</span>
      </button>
    )
  }

  return (
    <form className="cal-slot-add" onSubmit={(event) => { event.preventDefault(); finish(true) }}>
      <span className="cal-plus" aria-hidden="true">+</span>
      <input
        ref={inputRef}
        value={title}
        aria-label={`Ticket at ${label}`}
        placeholder="Ticket summary..."
        autoComplete="off"
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); finish(true) }
          if (event.key === 'Escape') { event.preventDefault(); finish(false) }
          if (event.key === 'Tab') {
            event.preventDefault()
            if (done.current) return
            done.current = true
            const next = (inputRef.current?.value ?? title).trim()
            if (next) onAdd(next)
            onStep(event.shiftKey ? -1 : 1)
          }
        }}
      />
    </form>
  )
}

function TaskLine({
  task,
  showTime,
  onToggle,
  onRemove,
  onSelectTask,
}: {
  task: CalTask
  showTime?: boolean
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onSelectTask?: (task: CalTask) => void
}) {
  const done = wf().isDone(task.status)
  const categoryIcons: Record<string, string> = {
    feature: '⚡',
    bug: '🐛',
    task: '📌',
    story: '🟢',
    epic: '🟣',
  }

  return (
    <div className="cal-row" data-done={done ? '' : undefined}>
      <button
        type="button"
        className="cal-mark"
        aria-pressed={done}
        aria-label={done ? `Reopen ${task.title}` : `Close ${task.title}`}
        onClick={() => onToggle(task.id)}
      >
        <span />
      </button>

      <div
        className="cal-row-content cal-clickable-row"
        onClick={() => onSelectTask?.(task)}
        title="Click to view/edit ticket details & comments"
      >
        <span className="cal-ticket-key-tag">{task.taskKey}</span>
        <span className="cal-cat-icon">{categoryIcons[task.category || 'task'] || '📌'}</span>
        <span className="cal-row-title">{task.title}</span>

        {task.storyPoints && (
          <span className="cal-points-badge" title={`${task.storyPoints} story points`}>
            {task.storyPoints}pt
          </span>
        )}

        {task.assigneeName && (
          <span className="cal-task-assignee-badge">
            👤 {task.assigneeName}
          </span>
        )}
      </div>

      {showTime && task.time && <time dateTime={task.time}>{hourLabel(task.time)}</time>}
      <button type="button" className="cal-btn" aria-label={`Remove ${task.title}`} onClick={() => onRemove(task.id)}>Remove</button>
    </div>
  )
}
