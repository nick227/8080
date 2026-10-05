import { useEffect, useRef } from 'react'
import { HOURS, hourLabel } from './dates'
import type { CalTask } from './types'

export function DayView({ day, today, tasks, onToggle, onRemove }: {
  day: string
  today: string
  tasks: CalTask[]
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}) {
  const planRef = useRef<HTMLDivElement>(null)
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
            </div>
          </section>
        )
      })}
    </div>
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
