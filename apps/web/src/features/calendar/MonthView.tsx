import { monthCells, monthName, dayTitle, parseDay } from './dates'
import { orderTasks } from './store'
import type { CalTask } from './types'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHOWN = 2

export function MonthView({ cursor, today, tasks, onOpen }: {
  cursor: string
  today: string
  tasks: CalTask[]
  onOpen: (day: string) => void
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
          const open = orderTasks(byDay.get(cell.key) ?? []).filter((task) => task.status === 'open')
          const shown = open.slice(0, SHOWN)
          const more = open.length - shown.length
          return (
            <button
              key={cell.key}
              type="button"
              className="cal-day"
              data-out={cell.inMonth ? undefined : ''}
              data-today={cell.key === today ? '' : undefined}
              aria-label={`Open ${dayTitle(cell.key)}, ${open.length} open`}
              onClick={() => onOpen(cell.key)}
            >
              <span className="cal-num">{parseDay(cell.key).getDate()}</span>
              {shown.map((task) => <span key={task.id} className="cal-task-title">{task.title}</span>)}
              {more > 0 && <span className="cal-more">{more} more</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
