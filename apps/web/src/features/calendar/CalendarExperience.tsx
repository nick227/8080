import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SectionHeader } from '../work/SectionHeader'
import { DayView } from './DayView'
import { addDays, dayKey, dayTitle, monthName, parseDay, todayKey } from './dates'
import { ImportModal } from './ImportModal'
import { MonthView } from './MonthView'
import { ListView } from './ListView'
import { BoardView } from './BoardView'
import { BacklogView } from './BacklogView'
import { NewTaskSlideout } from './NewTaskSlideout'
import { LogAccomplishmentModal } from './LogAccomplishmentModal'
import { TicketPage } from './TicketPage'
import { CalendarFilters } from './CalendarFilters'
import { useCalendar } from './store'
import type { CalTask } from './types'
import './calendar.css'

export function CalendarExperience() {
  const location = useLocation()
  const navigate = useNavigate()
  const searchParams = new URLSearchParams(location.search)
  const ticketParam = searchParams.get('ticket')

  const tasks = useCalendar((state) => state.tasks)
  const accomplishments = useCalendar((state) => state.accomplishments)
  const cursor = useCalendar((state) => state.cursor)
  const view = useCalendar((state) => state.view)
  const activeUserId = useCalendar((state) => state.activeUserId)
  const categoryFilter = useCalendar((state) => state.categoryFilter)
  const priorityFilter = useCalendar((state) => state.priorityFilter)

  const setView = useCalendar((state) => state.setView)
  const showMonth = useCalendar((state) => state.showMonth)
  const showDay = useCalendar((state) => state.showDay)
  const goToday = useCalendar((state) => state.goToday)
  const shiftMonth = useCalendar((state) => state.shiftMonth)
  const add = useCalendar((state) => state.add)
  const importTasks = useCalendar((state) => state.importTasks)
  const toggle = useCalendar((state) => state.toggle)
  const remove = useCalendar((state) => state.remove)
  const updateTaskStatus = useCalendar((state) => state.updateTaskStatus)

  const [expanded, setExpanded] = useState(false)
  const [importing, setImporting] = useState(false)
  const [composing, setComposing] = useState(false)
  const [loggingAcc, setLoggingAcc] = useState(false)
  const [selectedDayForNewTask, setSelectedDayForNewTask] = useState<string>(cursor)

  const today = todayKey()
  const onToday = view === 'day' ? cursor === today : cursor.slice(0, 7) === today.slice(0, 7)
  const title = view === 'day'
    ? dayTitle(cursor)
    : `${monthName(cursor)} ${parseDay(cursor).getFullYear()}`

  const datedView = view === 'month' || view === 'day' || view === 'list'
  const scopedTasks = tasks.filter(t => view === 'day' ? t.day === cursor : view === 'month' || view === 'list' ? t.day.slice(0, 7) === cursor.slice(0, 7) : view === 'backlog' ? t.status !== 'done' : true)
  const filteredTasks = scopedTasks.filter((t) => {
    if (activeUserId !== 'all' && t.assigneeId !== activeUserId) return false
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
    if (priorityFilter !== 'all' && t.priority !== priorityFilter && (priorityFilter === 'high' ? (t.priority !== 'high' && t.priority !== 'highest') : true)) return false
    return true
  })

  const filteredAccomplishments = activeUserId === 'all'
    ? accomplishments
    : accomplishments.filter((a) => a.assigneeId === activeUserId)

  const dayTasks = filteredTasks.filter((task) => task.day === cursor)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement
      if (event.key === 'Escape' && expanded && !document.querySelector('dialog[open]')) { setExpanded(false); return }
      if (event.key === 'Escape' && view === 'day' && !typing && !document.querySelector('dialog[open]')) showMonth()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showMonth, view, expanded])

  const handleOpenDayForAdd = (day: string) => {
    setSelectedDayForNewTask(day)
    setComposing(true)
  }

  // Dedicated Unique URL Ticket Navigation Helper
  const handleOpenTicket = (taskKey: string) => {
    const next = new URLSearchParams(location.search)
    next.set('desk', 'calendar')
    next.set('ticket', taskKey)
    navigate({ search: next.toString() })
  }

  const handleBackToCalendar = () => {
    const next = new URLSearchParams(location.search)
    next.delete('ticket')
    navigate({ search: next.toString() })
  }

  // If a ticket parameter is present in the URL, render the Dedicated Ticket Page
  if (ticketParam) {
    return (
      <TicketPage
        taskKey={ticketParam}
        onBack={handleBackToCalendar}
      />
    )
  }

  return (
    <div className="cal" data-expanded={expanded || undefined}>
      <SectionHeader
        title="Calendar"
        level={1}
        newLabel="ticket"
        onNew={() => {
          setSelectedDayForNewTask(cursor)
          setComposing(true)
        }}
        onImport={() => setImporting(true)}
      >
        {datedView && <button type="button" className="section-add-btn" onClick={() => setLoggingAcc(true)}>Log work</button>}
      </SectionHeader>

      <div className="cal-main-container">
        <header className="cal-bar">
          {datedView ? <div className="cal-nav" aria-label="Calendar dates">
            <button type="button" className="cal-btn" aria-label={view === 'day' ? 'Previous day' : 'Previous month'} onClick={() => view === 'day' ? showDay(dayKey(addDays(parseDay(cursor), -1))) : shiftMonth(-1)}>←</button>
            <button type="button" className="cal-btn" aria-label={view === 'day' ? 'Next day' : 'Next month'} onClick={() => view === 'day' ? showDay(dayKey(addDays(parseDay(cursor), 1))) : shiftMonth(1)}>→</button>
            <h2 className="cal-period">{title}</h2>
            <button type="button" className="cal-btn" aria-pressed={onToday} onClick={goToday}>Today</button>
          </div> : <h2 className="cal-period">{view === 'backlog' ? 'Open tasks · all dates' : 'Tasks by status · all dates'}</h2>}
          <div className="cal-tools">
            <div className="cal-view-toggle" role="group" aria-label="Calendar view">
              {(['month', 'day', 'list'] as const).map(v => <button key={v} type="button" className={`cal-btn ${view === v ? 'cal-view-active' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>)}
            </div>
            <select className="cal-btn" aria-label="More task views" value={view === 'board' || view === 'backlog' ? view : ''} onChange={e => { if (e.target.value) setView(e.target.value as 'board' | 'backlog') }}>
              <option value="" disabled>More views</option><option value="board">Board</option><option value="backlog">Backlog</option>
            </select>
          </div>
        </header>
        <CalendarFilters tasks={scopedTasks} count={filteredTasks.length} />

        {view === 'day' ? (
          <DayView
            day={cursor}
            today={today}
            tasks={dayTasks}
            accomplishments={filteredAccomplishments}
            onAdd={(taskTitle, time) => add({ title: taskTitle, day: cursor, time })}
            onToggle={toggle}
            onRemove={remove}
            onSelectTask={(task) => handleOpenTicket(task.taskKey)}
          />
        ) : view === 'list' ? (
          <ListView
            cursor={cursor}
            today={today}
            tasks={filteredTasks}
            accomplishments={filteredAccomplishments}
            onAddForDay={(dayKey, taskTitle, time) => add({ title: taskTitle, day: dayKey, time })}
            onToggle={toggle}
            onRemove={remove}
            onSelectTask={(task) => handleOpenTicket(task.taskKey)}
          />
        ) : view === 'board' ? (
          <BoardView
            tasks={filteredTasks}
            onSelectTask={(task) => handleOpenTicket(task.taskKey)}
            onUpdateStatus={(taskId, status) => updateTaskStatus(taskId, status)}
          />
        ) : view === 'backlog' ? (
          <BacklogView
            tasks={filteredTasks}
            onSelectTask={(task) => handleOpenTicket(task.taskKey)}
            onUpdateStatus={(taskId, status) => updateTaskStatus(taskId, status)}
          />
        ) : (
          <MonthView
            cursor={cursor}
            today={today}
            tasks={filteredTasks}
            accomplishments={filteredAccomplishments}
            onOpen={showDay}
            onAddForDay={handleOpenDayForAdd}
            onSelectTask={(task) => handleOpenTicket(task.taskKey)}
          />
        )}
      </div>

      {composing && (
        <NewTaskSlideout
          initialDay={selectedDayForNewTask}
          onClose={() => setComposing(false)}
        />
      )}

      {loggingAcc && (
        <LogAccomplishmentModal
          initialDay={cursor}
          onClose={() => setLoggingAcc(false)}
        />
      )}

      {importing && (
        <ImportModal
          mode={view === 'day' ? 'list' : 'csv'}
          day={cursor}
          onClose={() => setImporting(false)}
          onImport={importTasks}
        />
      )}
    </div>
  )
}
