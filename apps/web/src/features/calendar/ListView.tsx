import { useState, useRef } from 'react'
import { monthCells, dayTitle, parseDay, HOURS, hourLabel } from './dates'
import type { CalTask, CalAccomplishment } from './types'
import { wf } from './store'
import { WorkEntryChip } from './WorkEntryChip'

export function ListView({
  cursor,
  today,
  tasks,
  accomplishments,
  onAddForDay,
  onToggle,
  onRemove,
  onSelectTask,
}: {
  cursor: string
  today: string
  tasks: CalTask[]
  accomplishments: CalAccomplishment[]
  onAddForDay: (day: string, title: string, time: string | null) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onSelectTask?: (task: CalTask) => void
}) {
  const cells = monthCells(cursor).filter((c) => c.inMonth)
  const byDayTasks = new Map<string, CalTask[]>()
  for (const task of tasks) {
    if (!task.day) continue
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
    <div className="cal-list-view" role="region" aria-label="Calendar Agenda List View">
      <div className="cal-list-days">
        {cells.map((cell) => {
          const dayKey = cell.key
          const dayTasks = byDayTasks.get(dayKey) ?? []
          const dayAccs = byDayAccs.get(dayKey) ?? []
          const isToday = dayKey === today

          return (
            <DayListSection
              key={dayKey}
              dayKey={dayKey}
              isToday={isToday}
              tasks={dayTasks}
              accomplishments={dayAccs}
              onAddForDay={onAddForDay}
              onToggle={onToggle}
              onRemove={onRemove}
              onSelectTask={onSelectTask}
            />
          )
        })}
      </div>
    </div>
  )
}

function DayListSection({
  dayKey,
  isToday,
  tasks,
  accomplishments,
  onAddForDay,
  onToggle,
  onRemove,
  onSelectTask,
}: {
  dayKey: string
  isToday: boolean
  tasks: CalTask[]
  accomplishments: CalAccomplishment[]
  onAddForDay: (day: string, title: string, time: string | null) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onSelectTask?: (task: CalTask) => void
}) {
  const [adding, setAdding] = useState(false)
  const [quickTitle, setQuickTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const untimed = tasks.filter((t) => !t.time)
  const byHour = new Map<string, CalTask[]>()
  for (const task of tasks) {
    if (!task.time) continue
    const hourKey = `${task.time.slice(0, 2)}:00`
    const list = byHour.get(hourKey)
    if (list) list.push(task)
    else byHour.set(hourKey, [task])
  }

  const submitQuickAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickTitle.trim()) return
    onAddForDay(dayKey, quickTitle.trim(), null)
    setQuickTitle('')
    setAdding(false)
  }

  const openCount = tasks.filter((t) => !wf().isDone(t.status)).length

  return (
    <section className="cal-list-day" data-today={isToday ? '' : undefined}>
      <header className="cal-list-day-header">
        <div className="cal-list-day-title-group">
          <span className="cal-list-day-num">{parseDay(dayKey).getDate()}</span>
          <div>
            <h3 className="cal-list-day-name">{dayTitle(dayKey)}</h3>
            <span className="cal-list-day-sub">
              {openCount} open ticket{openCount === 1 ? '' : 's'}
              {accomplishments.length > 0 && ` · ${accomplishments.length} work log${accomplishments.length === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>

        {/* Plus sign at the day level */}
        <button
          type="button"
          className="cal-day-add-btn"
          title={`Add ticket to ${dayTitle(dayKey)}`}
          aria-label={`Add ticket to ${dayTitle(dayKey)}`}
          onClick={() => {
            setAdding(true)
            setTimeout(() => inputRef.current?.focus(), 50)
          }}
        >
          <span className="cal-plus-icon">+</span>
          <span className="cal-add-text">Add Ticket</span>
        </button>
      </header>

      {adding && (
        <form className="cal-list-quick-form" onSubmit={submitQuickAdd}>
          <span className="cal-plus-icon">+</span>
          <input
            ref={inputRef}
            type="text"
            placeholder={`Add ticket summary for ${dayTitle(dayKey)}...`}
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <button type="submit" className="cal-btn" data-primary="">Add</button>
          <button type="button" className="cal-btn" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}

      {/* Accomplishments / Work Log Section */}
      {accomplishments.length > 0 && (
        <div className="cal-list-accomplishments">
          {accomplishments.map((acc) => (
            <WorkEntryChip key={acc.id} entry={acc} />
          ))}
        </div>
      )}

      {/* Hourly breakdown */}
      <div className="cal-list-hours">
        {untimed.length > 0 && (
          <div className="cal-list-hour-row">
            <div className="cal-list-hour-label">Anytime</div>
            <div className="cal-list-hour-tasks">
              {untimed.map((t) => (
                <ListTaskLine
                  key={t.id}
                  task={t}
                  onToggle={onToggle}
                  onRemove={onRemove}
                  onSelectTask={onSelectTask}
                />
              ))}
            </div>
          </div>
        )}

        {HOURS.map((hour) => {
          const hourTasks = byHour.get(hour.value) ?? []
          if (hourTasks.length === 0) return null
          return (
            <div key={hour.value} className="cal-list-hour-row">
              <div className="cal-list-hour-label">{hour.label}</div>
              <div className="cal-list-hour-tasks">
                {hourTasks.map((t) => (
                  <ListTaskLine
                    key={t.id}
                    task={t}
                    onToggle={onToggle}
                    onRemove={onRemove}
                    onSelectTask={onSelectTask}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {tasks.length === 0 && accomplishments.length === 0 && !adding && (
          <p className="cal-list-empty">No tickets scheduled for this day.</p>
        )}
      </div>
    </section>
  )
}

function ListTaskLine({
  task,
  onToggle,
  onRemove,
  onSelectTask,
}: {
  task: CalTask
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

      {task.time && <time dateTime={task.time}>{hourLabel(task.time)}</time>}
      <button
        type="button"
        className="cal-btn"
        aria-label={`Remove ${task.title}`}
        onClick={() => onRemove(task.id)}
      >
        Remove
      </button>
    </div>
  )
}
