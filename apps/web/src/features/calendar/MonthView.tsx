import { monthCells, monthName, dayTitle, parseDay } from './dates'
import { orderTasks } from './store'
import type { CalTask } from './types'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHOWN = 1

export function MonthView({ cursor, today, tasks, onOpen, onToggle }: {
  cursor: string
  today: string
  tasks: CalTask[]
  onOpen: (day: string) => void
  onToggle: (id: string) => void
}) {
  const byDay = new Map<string, CalTask[]>()
  for (const task of tasks) {
    const list = byDay.get(task.day)
    if (list) list.push(task)
    else byDay.set(task.day, [task])
  }
  return (
    <div className="cal-board" role="group" aria-label={`${monthName(cursor)} ${parseDay(cursor).getFullYear()}`}>
      <div className="cal-dows">
        {DOW.map((name) => <div key={name} className="cal-dow">{name}</div>)}
      </div>
      <div className="cal-days">
        {monthCells(cursor).map((cell) => {
          const ordered = orderTasks(byDay.get(cell.key) ?? [])
          const open = ordered.filter((task) => task.status === 'open')
          const done = ordered.length - open.length
          const shown = open.slice(0, SHOWN)
          const more = open.length - shown.length
          return (
            <div key={cell.key} className="cal-day" data-out={cell.inMonth ? undefined : ''} data-today={cell.key === today ? '' : undefined}>
              <button
                type="button"
                className="cal-open"
                aria-label={`${dayTitle(cell.key)}, ${open.length} open`}
                onClick={() => onOpen(cell.key)}
              >
                <span className="cal-num">{parseDay(cell.key).getDate()}</span>
                {open.length > 0 && <span className="cal-count">{open.length} open</span>}
              </button>
              <ul className="cal-tasks">
                {shown.map((task) => (
                  <li key={task.id} className="cal-task">
                    <button type="button" className="cal-check" aria-label={`Close ${task.title}`} onClick={() => onToggle(task.id)}>
                      <span />
                    </button>
                    <span className="cal-task-title">{task.title}</span>
                  </li>
                ))}
                {more > 0 && <li className="cal-more">{more} more</li>}
                {shown.length === 0 && done > 0 && <li className="cal-more">{done} done</li>}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
