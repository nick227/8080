import { monthCells, monthName, dayTitle, parseDay } from './dates'
import { orderTasks } from './store'
import type { CalTask, CalAccomplishment } from './types'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHOWN = 3

export function MonthView({
  cursor,
  today,
  tasks,
  accomplishments = [],
  onOpen,
  onAddForDay,
  onSelectTask,
}: {
  cursor: string
  today: string
  tasks: CalTask[]
  accomplishments?: CalAccomplishment[]
  onOpen: (day: string) => void
  onAddForDay: (day: string) => void
  onSelectTask?: (task: CalTask) => void
}) {
  const byDayTasks = new Map<string, CalTask[]>()
  for (const task of tasks) {
    const list = byDayTasks.get(task.day)
    if (list) list.push(task)
    else byDayTasks.set(task.day, [task])
  }

  const byDayAccs = new Map<string, CalAccomplishment[]>()
  for (const acc of accomplishments) {
    const list = byDayAccs.get(acc.day)
    if (list) list.push(acc)
    else byDayAccs.set(acc.day, [acc])
  }

  return (
    <div className="cal-board" role="group" aria-label={`${monthName(cursor)} ${parseDay(cursor).getFullYear()}`}>
      <div className="cal-dows">
        {DOW.map((name) => (
          <div key={name} className="cal-dow">{name}</div>
        ))}
      </div>
      <div className="cal-days">
        {monthCells(cursor).map((cell) => {
          const dayTasks = orderTasks(byDayTasks.get(cell.key) ?? [])
          const dayAccs = byDayAccs.get(cell.key) ?? []
          const open = dayTasks.filter((task) => task.status !== 'done')
          const shownTasks = dayTasks.slice(0, SHOWN)
          const more = dayTasks.length - shownTasks.length

          return (
            <div
              key={cell.key}
              className="cal-day"
              data-out={cell.inMonth ? undefined : ''}
              data-today={cell.key === today ? '' : undefined}
              onClick={() => onOpen(cell.key)}
              tabIndex={0}
              role="button"
              aria-label={`Open ${dayTitle(cell.key)}, ${open.length} open tasks`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(cell.key)
                }
              }}
            >
              <div className="cal-day-header-line">
                <span className="cal-num">{parseDay(cell.key).getDate()}</span>
                {/* Plus sign at the day level */}
                <button
                  type="button"
                  className="cal-day-plus-btn"
                  title={`Add ticket for ${dayTitle(cell.key)}`}
                  aria-label={`Add ticket for ${dayTitle(cell.key)}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddForDay(cell.key)
                  }}
                >
                  +
                </button>
              </div>

              {/* Accomplishment Chips */}
              {dayAccs.length > 0 && (
                <div className="cal-day-accs">
                  {dayAccs.slice(0, 2).map((acc) => (
                    <span key={acc.id} className="cal-day-acc-badge" title={acc.title}>
                      <span className="cal-acc-icon">{acc.icon || '✨'}</span>
                      <span className="cal-acc-text">{acc.title}</span>
                    </span>
                  ))}
                </div>
              )}

              <span className="cal-entries">
                {shownTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="cal-task-title"
                    data-done={task.status === 'done' ? '' : undefined}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectTask?.(task)
                    }}
                    title={`Click to open ${task.taskKey}: ${task.title}`}
                  >
                    <span className="cal-ticket-key-mini">{task.taskKey}</span>
                    {task.assigneeName && (
                      <span className="cal-mini-assignee" title={`Assigned to ${task.assigneeName}`}>
                        {task.assigneeName.split(' ').map((n) => n[0]).join('')}
                      </span>
                    )}
                    <span className="cal-task-text">{task.title}</span>
                  </button>
                ))}
                {more > 0 && <span className="cal-more">+{more} more</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
