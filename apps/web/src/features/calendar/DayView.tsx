import { useEffect, useRef, useState } from 'react'
import { HOURS, hourLabel } from './dates'
import type { CalTask } from './types'

export function DayView({ day, today, tasks, onAdd, onToggle, onRemove }: {
  day: string
  today: string
  tasks: CalTask[]
  onAdd: (title: string, time: string) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
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

  return (
    <div className="cal-plan" ref={planRef}>
      {untimed.length > 0 && (
        <section className="cal-slot" data-has="">
          <span className="cal-hour">Any</span>
          <div className="cal-slot-tasks">
            {untimed.map((task) => <TaskLine key={task.id} task={task} onToggle={onToggle} onRemove={onRemove} />)}
          </div>
        </section>
      )}
      {HOURS.map((hour) => {
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
                <TaskLine key={task.id} task={task} showTime={task.time !== hour.value} onToggle={onToggle} onRemove={onRemove} />
              ))}
              <HourAdd
                label={hour.label}
                editing={editing === hour.value}
                onOpen={() => setEditing(hour.value)}
                onClose={() => setEditing((current) => current === hour.value ? null : current)}
                onAdd={(title) => onAdd(title, hour.value)}
              />
            </div>
          </section>
        )
      })}
    </div>
  )
}

function HourAdd({ label, editing, onOpen, onClose, onAdd }: {
  label: string
  editing: boolean
  onOpen: () => void
  onClose: () => void
  onAdd: (title: string) => void
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
      <button type="button" className="cal-slot-add" aria-label={`Add a task at ${label}`} onClick={onOpen}>
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
        aria-label={`Task at ${label}`}
        placeholder="Task"
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

function TaskLine({ task, showTime, onToggle, onRemove }: {
  task: CalTask
  showTime?: boolean
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}) {
  const done = task.status === 'done'
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
      <span className="cal-row-title">{task.title}</span>
      {showTime && task.time && <time dateTime={task.time}>{hourLabel(task.time)}</time>}
      <button type="button" className="cal-btn" aria-label={`Remove ${task.title}`} onClick={() => onRemove(task.id)}>Remove</button>
    </div>
  )
}
