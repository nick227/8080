import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCurrentWorkspace } from '../documents/workspace'
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
import { applyFilters, filtersActive, NO_FILTERS, useCalendar, type Filters, type View } from './store'
import { useLocalTasks, useTaskSync } from './sync'
import type { CalTask, TaskStatus } from './types'
import './calendar.css'

const VIEWS: { id: View; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'day', label: 'Day' },
  { id: 'list', label: 'List' },
  { id: 'board', label: 'Board' },
  { id: 'backlog', label: 'Backlog' },
]

// View and filters are part of the address, so a filtered board can be shared.
const LIST_PARAMS = { who: 'members', type: 'types', area: 'areas', priority: 'priorities' } as const

function readUrl(search: string): { view?: View; filters: Filters } {
  const params = new URLSearchParams(search)
  const filters: Filters = { ...NO_FILTERS }
  for (const [param, key] of Object.entries(LIST_PARAMS)) {
    const raw = params.get(param)
    if (raw) (filters[key] as string[]) = raw.split(',').filter(Boolean)
  }
  filters.search = params.get('q') ?? ''
  const view = params.get('view') as View | null
  return { view: view && VIEWS.some((v) => v.id === view) ? view : undefined, filters }
}

function writeUrl(search: string, view: View, filters: Filters) {
  const params = new URLSearchParams(search)
  params.set('view', view)
  for (const [param, key] of Object.entries(LIST_PARAMS)) {
    const list = filters[key] as string[]
    if (list.length) params.set(param, list.join(','))
    else params.delete(param)
  }
  if (filters.search.trim()) params.set('q', filters.search)
  else params.delete('q')
  return params.toString()
}

export function CalendarExperience() {
  const { workspace, loading, guest, create, creating, createError } = useCurrentWorkspace()
  if (loading) return <p className="cal-gate" role="status">Loading workspace…</p>
  if (!workspace) {
    return (
      <div className="cal-gate">
        <h2>{guest ? 'Sign in to plan work with your team' : 'Create your workspace'}</h2>
        <p>Tasks belong to a workspace, so everyone on the team sees the same calendar and board.</p>
        {!guest && <button type="button" className="cal-btn" data-primary="" onClick={create} disabled={creating}>{creating ? 'Creating…' : 'Create workspace'}</button>}
        {createError && <p role="alert">{createError}</p>}
      </div>
    )
  }
  return <Calendar key={workspace.id} />
}

function Calendar() {
  const location = useLocation()
  const navigate = useNavigate()
  const ticketParam = new URLSearchParams(location.search).get('ticket')
  const sync = useTaskSync()
  const local = useLocalTasks()

  const tasks = useCalendar((state) => state.tasks)
  const loaded = useCalendar((state) => state.loaded)
  const accomplishments = useCalendar((state) => state.accomplishments)
  const cursor = useCalendar((state) => state.cursor)
  const view = useCalendar((state) => state.view)
  const filters = useCalendar((state) => state.filters)
  const notice = useCalendar((state) => state.notice)

  const setView = useCalendar((state) => state.setView)
  const setFilters = useCalendar((state) => state.setFilters)
  const clearFilters = useCalendar((state) => state.clearFilters)
  const showMonth = useCalendar((state) => state.showMonth)
  const showDay = useCalendar((state) => state.showDay)
  const goToday = useCalendar((state) => state.goToday)
  const shiftMonth = useCalendar((state) => state.shiftMonth)
  const add = useCalendar((state) => state.add)
  const importTasks = useCalendar((state) => state.importTasks)
  const toggle = useCalendar((state) => state.toggle)
  const remove = useCalendar((state) => state.remove)
  const updateTaskStatus = useCalendar((state) => state.updateTaskStatus)
  const dismiss = useCalendar((state) => state.dismiss)

  const [expanded, setExpanded] = useState(false)
  const [importing, setImporting] = useState(false)
  const [composing, setComposing] = useState(false)
  const [loggingAcc, setLoggingAcc] = useState(false)
  const [selectedDayForNewTask, setSelectedDayForNewTask] = useState<string>(cursor)
  const [createIn, setCreateIn] = useState<TaskStatus | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // URL → store once, then store → URL.
  const fromUrl = useRef(false)
  const justRead = useRef(false)
  useEffect(() => {
    if (fromUrl.current) return
    fromUrl.current = true
    justRead.current = true
    const { view: urlView, filters: urlFilters } = readUrl(location.search)
    if (urlView) setView(urlView)
    setFilters(urlFilters)
  }, [location.search, setFilters, setView])
  useEffect(() => {
    if (!fromUrl.current) return
    // The store takes the URL's values on the next render; don't overwrite them first.
    if (justRead.current) { justRead.current = false; return }
    const next = writeUrl(location.search, view, filters)
    if (next !== location.search.replace(/^\?/, '')) navigate({ search: next }, { replace: true })
  }, [view, filters, location.search, navigate])

  // Notices fade on their own; Undo stays a few seconds.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(dismiss, notice.undo ? 8000 : 4000)
    return () => clearTimeout(timer)
  }, [notice, dismiss])

  const today = todayKey()
  const onToday = view === 'day' ? cursor === today : cursor.slice(0, 7) === today.slice(0, 7)
  const title = view === 'day' ? dayTitle(cursor) : `${monthName(cursor)} ${parseDay(cursor).getFullYear()}`

  const datedView = view === 'month' || view === 'day' || view === 'list'
  const scopedTasks = tasks.filter((t) =>
    view === 'day' ? t.day === cursor
      : view === 'month' || view === 'list' ? !!t.day && t.day.slice(0, 7) === cursor.slice(0, 7)
        : view === 'backlog' ? t.status !== 'done'
          : true,
  )
  const filteredTasks = applyFilters(scopedTasks, filters)
  const filteredAccomplishments = filters.members.length ? accomplishments.filter((a) => filters.members.includes(a.assigneeId ?? 'unassigned')) : accomplishments
  const dayTasks = filteredTasks.filter((task) => task.day === cursor)

  const openTicket = useCallback((task: CalTask) => {
    if (task.pending) return
    const next = new URLSearchParams(location.search)
    next.set('desk', 'calendar')
    next.set('ticket', task.taskKey)
    navigate({ search: next.toString() })
  }, [location.search, navigate])

  const closeTicket = useCallback(() => {
    const next = new URLSearchParams(location.search)
    next.delete('ticket')
    navigate({ search: next.toString() })
  }, [location.search, navigate])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable
      const dialog = !!document.querySelector('dialog[open], [aria-modal="true"]')
      if (event.key === 'Escape' && ticketParam && !typing && !dialog) { closeTicket(); return }
      if (event.key === 'Escape' && expanded && !dialog) { setExpanded(false); return }
      if (event.key === 'Escape' && view === 'day' && !typing && !dialog) { showMonth(); return }
      if (typing || dialog || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus() }
      if (event.key === 'c' && !ticketParam) {
        event.preventDefault()
        if (view === 'board') setCreateIn('open')
        else { setSelectedDayForNewTask(cursor); setComposing(true) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showMonth, view, expanded, ticketParam, closeTicket, cursor])

  const handleOpenDayForAdd = (day: string) => {
    setSelectedDayForNewTask(day)
    setComposing(true)
  }

  return (
    <div className="cal" data-expanded={expanded || undefined}>
      <SectionHeader
        title="Calendar"
        level={1}
        newLabel="task"
        onNew={() => {
          if (view === 'board') { setCreateIn('open'); return }
          setSelectedDayForNewTask(cursor)
          setComposing(true)
        }}
        onImport={() => setImporting(true)}
      >
        {datedView && <button type="button" className="section-add-btn" onClick={() => setLoggingAcc(true)}>Log work</button>}
      </SectionHeader>

      {local.count > 0 && (
        <div className="cal-banner" role="status">
          <span>
            {local.count} {local.count === 1 ? 'task is' : 'tasks are'} saved only in this browser.
            {local.state === 'failed' && ' Moving them failed; try again.'}
          </span>
          <button type="button" className="cal-btn" data-primary="" disabled={local.state === 'moving'} onClick={() => void local.move()}>
            {local.state === 'moving' ? 'Moving…' : 'Move to workspace'}
          </button>
          <button type="button" className="cal-btn" disabled={local.state === 'moving'} onClick={() => { if (window.confirm('Discard the tasks saved in this browser?')) local.discard() }}>
            Discard
          </button>
        </div>
      )}

      <div className="cal-main-container">
        <header className="cal-bar">
          {datedView ? <div className="cal-nav" aria-label="Calendar dates">
            <button type="button" className="cal-btn" aria-label={view === 'day' ? 'Previous day' : 'Previous month'} onClick={() => view === 'day' ? showDay(dayKey(addDays(parseDay(cursor), -1))) : shiftMonth(-1)}>←</button>
            <button type="button" className="cal-btn" aria-label={view === 'day' ? 'Next day' : 'Next month'} onClick={() => view === 'day' ? showDay(dayKey(addDays(parseDay(cursor), 1))) : shiftMonth(1)}>→</button>
            <h2 className="cal-period">{title}</h2>
            <button type="button" className="cal-btn" aria-pressed={onToday} onClick={goToday}>Today</button>
          </div> : <h2 className="cal-period">{view === 'backlog' ? 'Open tasks · all dates' : 'Board · all tasks'}</h2>}
          <div className="cal-tools">
            <div className="cal-view-toggle" role="group" aria-label="Calendar view">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" className={`cal-btn ${view === v.id ? 'cal-view-active' : ''}`} aria-pressed={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>
              ))}
            </div>
          </div>
        </header>
        <CalendarFilters ref={searchRef} count={filteredTasks.length} total={scopedTasks.length} />

        {sync.error && !loaded ? (
          <p className="cal-board-note" role="alert">
            Tasks couldn't load: {sync.error} <button type="button" className="cal-link-btn" onClick={sync.retry}>Retry</button>
          </p>
        ) : !loaded ? (
          <p className="cal-board-note" role="status">Loading tasks…</p>
        ) : view === 'day' ? (
          <DayView
            day={cursor}
            today={today}
            tasks={dayTasks}
            accomplishments={filteredAccomplishments}
            onAdd={(taskTitle, time) => add({ title: taskTitle, day: cursor, time })}
            onToggle={toggle}
            onRemove={remove}
            onSelectTask={openTicket}
          />
        ) : view === 'list' ? (
          <ListView
            cursor={cursor}
            today={today}
            tasks={filteredTasks}
            accomplishments={filteredAccomplishments}
            onAddForDay={(day, taskTitle, time) => add({ title: taskTitle, day, time })}
            onToggle={toggle}
            onRemove={remove}
            onSelectTask={openTicket}
          />
        ) : view === 'board' ? (
          <BoardView
            tasks={filteredTasks}
            onSelectTask={openTicket}
            filtersOn={filtersActive(filters)}
            onClearFilters={clearFilters}
            createIn={createIn}
            onCreateHandled={() => setCreateIn(null)}
          />
        ) : view === 'backlog' ? (
          <BacklogView tasks={filteredTasks} onSelectTask={openTicket} onUpdateStatus={updateTaskStatus} />
        ) : (
          <MonthView
            cursor={cursor}
            today={today}
            tasks={filteredTasks}
            accomplishments={filteredAccomplishments}
            onOpen={showDay}
            onAddForDay={handleOpenDayForAdd}
            onSelectTask={openTicket}
          />
        )}
      </div>

      {ticketParam && (
        <div className="cal-panel-layer">
          <div className="cal-panel-scrim" onClick={closeTicket} aria-hidden="true" />
          <div className="cal-panel">
            <TicketPage taskKey={ticketParam} onBack={closeTicket} variant="panel" />
          </div>
        </div>
      )}

      {notice && (
        <div className="cal-toast" role="status" key={notice.id}>
          <span>{notice.text}</span>
          {notice.undo && <button type="button" className="cal-link-btn" onClick={notice.undo}>Undo</button>}
          <button type="button" className="cal-icon-btn" aria-label="Dismiss" onClick={dismiss}>×</button>
        </div>
      )}

      {composing && <NewTaskSlideout initialDay={selectedDayForNewTask} onClose={() => setComposing(false)} />}
      {loggingAcc && <LogAccomplishmentModal initialDay={cursor} onClose={() => setLoggingAcc(false)} />}
      {importing && (
        <ImportModal mode={view === 'day' ? 'list' : 'csv'} day={cursor} onClose={() => setImporting(false)} onImport={importTasks} />
      )}
    </div>
  )
}
