import { orderTasks } from './store'
import type { CalTask } from './types'

export function DayView({ tasks, onToggle, onRemove }: {
  tasks: CalTask[]
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}) {
  const ordered = orderTasks(tasks)
  return (
    <ul className="cal-rows">
      {ordered.length === 0 && <li className="cal-empty">No tasks on this day.</li>}
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
          {task.time && <time dateTime={task.time}>{task.time}</time>}
          <button type="button" className="cal-btn" aria-label={`Remove ${task.title}`} onClick={() => onRemove(task.id)}>Remove</button>
        </li>
      ))}
    </ul>
  )
}
