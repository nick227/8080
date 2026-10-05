import { parseDay } from './dates'
import { orderTasks } from './store'
import type { CalTask } from './types'

export function DayView({ day, today, tasks, onToggle, onRemove }: {
  day: string
  today: string
  tasks: CalTask[]
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}) {
  const ordered = orderTasks(tasks.filter((task) => task.day === day))
  const open = ordered.filter((task) => task.status === 'open').length
  return (
    <div className="cal-dayview">
      <div className="cal-figure-col">
        <p className="cal-figure" data-today={day === today ? '' : undefined}>{parseDay(day).getDate()}</p>
        <p className="cal-figure-meta">{open} open</p>
      </div>
      <ul className="cal-rows">
        {ordered.length === 0 && <li className="cal-empty">Nothing on this day. Add a task, or push a list onto it.</li>}
        {ordered.map((task) => (
          <li key={task.id} className="cal-row" data-done={task.status === 'done' ? '' : undefined}>
            <button
              type="button"
              className="cal-mark"
              aria-pressed={task.status === 'done'}
              aria-label={task.status === 'done' ? `Reopen ${task.title}` : `Close ${task.title}`}
              onClick={() => onToggle(task.id)}
            >
              <span />
            </button>
            <span className="cal-row-title">{task.title}</span>
            <span className="cal-row-meta">
              {task.time && <time dateTime={task.time}>{task.time}</time>}
              {task.source && <span className="cal-source">{task.source}</span>}
              <button type="button" className="cal-remove" aria-label={`Remove ${task.title}`} onClick={() => onRemove(task.id)}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
