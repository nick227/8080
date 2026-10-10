import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { isUrgencyKey } from '@project/shared'
import { useCreateCompany, useCurrentWorkspace } from '../documents/workspace'
import { onCompanyPath, taskPath, tasksPath } from '../tasks/links'
import { SectionHeader } from '../work/SectionHeader'
import { CollectionHeader } from '../collections/CollectionView'
import { DayView } from './DayView'
import { addDays, dayKey, dayTitle, monthName, parseDay, todayKey } from './dates'
import { ImportModal } from './ImportModal'
import { MonthView } from './MonthView'
import { ListView } from './ListView'
import { BoardView } from './BoardView'
import { BacklogView } from './BacklogView'
import { TableView } from './TableView'
import { ReportsView } from './ReportsView'
import { SavedViews } from './SavedViews'
import { NewTaskSlideout } from './NewTaskSlideout'
import { LogAccomplishmentModal } from './LogAccomplishmentModal'
import { TicketPage } from './TicketPage'
import { ForYou } from './ForYou'
import { BulkBar } from './BulkBar'
import { FieldPickerHost } from './FieldPicker'
import { WorkflowEditor } from './WorkflowEditor'
import { CalendarFilters } from './CalendarFilters'
import { applyFilters, filtersActive, NO_FILTERS, useCalendar, useWorkflow, type Filters, type View } from './store'
import { useLocalTasks, useTaskSync } from './sync'
import type { CalTask, TaskStatus } from './types'
import './calendar.css'

const VIEWS: { id: View; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'day', label: 'Day' },
  { id: 'list', label: 'List' },
  { id: 'board', label: 'Board' },
  { id: 'table', label: 'Table' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'reports', label: 'Reports' },
]

type TaskSection = 'calendar' | 'board' | 'table' | 'tasks'
const SECTION_VIEWS: Record<TaskSection, View[]> = {
  calendar: ['month', 'day', 'list'],
  board: ['board', 'backlog', 'reports'],
  table: ['table'],
  // Board is its own canvas in the nav (redesign D9): the Tasks list is the table or its reports.
  tasks: ['table', 'reports'],
}

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
  filters.urgency = (params.get('attention') ?? '').split(',').filter(isUrgencyKey)
  // Older links used blocked=1.
  if (params.get('blocked') === '1' && !filters.urgency.includes('blocked')) filters.urgency.push('blocked')
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
  params.delete('blocked')
  if (filters.urgency.length) params.set('attention', filters.urgency.join(','))
  else params.delete('attention')
  if (filters.search.trim()) params.set('q', filters.search)
  else params.delete('q')
  return params.toString()
}

export function CalendarExperience({ section = 'calendar' }: { section?: TaskSection }) {
  const { taskKey } = useParams()
  const { workspace, loading, guest } = useCurrentWorkspace()
  const { create, creating, createError } = useCreateCompany()
  if (loading) return <p className="cal-gate" role="status">Loading workspace…</p>
  if (!workspace) {
    return (
      <div className="cal-gate">
        <h2>{guest ? 'Sign in to plan work with your team' : 'Create your company'}</h2>
        <p>Tasks belong to a company, so everyone on the team sees the same calendar and board.</p>
        {!guest && <button type="button" className="cal-btn" data-primary="" onClick={create} disabled={creating}>{creating ? 'Creating…' : 'Create company'}</button>}
        {createError && <p role="alert">{createError}</p>}
      </div>
    )
  }
  return <Calendar key={`${workspace.id}:${section}:${taskKey ?? "list"}`} section={section} workspaceId={workspace.id} canManage={workspace.role === 'owner' || workspace.role === 'admin'} />
}

function Calendar({ workspaceId, canManage, section }: { workspaceId: string; canManage: boolean; section: TaskSection }) {
  const views = SECTION_VIEWS[section].map((id) => VIEWS.find((item) => item.id === id)!)
  // Board and Calendar show the same tasks as the Tasks list, and say so.
  const sectionTitle = section === 'calendar' ? 'Tasks · Calendar' : section === 'board' ? 'Tasks · Board' : section === 'tasks' ? 'Tasks' : 'Table'
  const location = useLocation()
  const navigate = useNavigate()
  const { taskKey: pageTaskKey } = useParams()
  const ticketParam = pageTaskKey ?? new URLSearchParams(location.search).get('ticket')
  const sync = useTaskSync()
  const local = useLocalTasks()

  const tasks = useCalendar((state) => state.tasks)
  const loaded = useCalendar((state) => state.loaded)
  const accomplishments = useCalendar((state) => state.accomplishments)
  const cursor = useCalendar((state) => state.cursor)
  const storedView = useCalendar((state) => state.view)
  const view = SECTION_VIEWS[section].includes(storedView) ? storedView : SECTION_VIEWS[section][0]
  const filters = useCalendar((state) => state.filters)
  const workflow = useWorkflow()
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
  const [editingWorkflow, setEditingWorkflow] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Read shared links and browser history; preserve local edits when writing the URL.
  const fromUrl = useRef<string | null>(null)
  const justRead = useRef(false)
  useEffect(() => {
    if (fromUrl.current === location.search) return
    fromUrl.current = location.search
    justRead.current = true
    const { view: urlView, filters: urlFilters } = readUrl(location.search)
    setView(urlView && SECTION_VIEWS[section].includes(urlView) ? urlView : SECTION_VIEWS[section][0])
    setFilters(urlFilters)
  }, [location.search, setFilters, setView, section])
  useEffect(() => {
    if (fromUrl.current === null || pageTaskKey) return
    // The store takes the URL's values on the next render; don't overwrite them first.
    if (justRead.current) { justRead.current = false; return }
    const params = new URLSearchParams(location.search)
    // Rooms keep the desk in the query; company routes carry it in the path.
    if (onCompanyPath(location.pathname)) params.delete('desk')
    else params.set('desk', section === 'table' ? 'company' : section)
    const next = writeUrl(params.toString(), view, filters)
    if (next !== location.search.replace(/^\?/, '')) {
      fromUrl.current = `?${next}`
      navigate({ search: next }, { replace: true })
    }
  }, [view, filters, location.search, location.pathname, navigate, section, pageTaskKey])

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
        : view === 'backlog' ? !workflow.isDone(t.status)
          : true,
  )
  const filteredTasks = applyFilters(scopedTasks, filters, { today, now: Date.now(), isDone: workflow.isDone })
  const filteredAccomplishments = filters.members.length ? accomplishments.filter((a) => filters.members.includes(a.assigneeId ?? 'unassigned')) : accomplishments
  const dayTasks = filteredTasks.filter((task) => task.day === cursor)

  const openTicket = useCallback((task: CalTask) => {
    if (task.pending) return
    navigate(taskPath(location.pathname, task.taskKey), { state: { taskListSearch: location.search } })
  }, [location.pathname, location.search, navigate, section])

  const openTicketKey = useCallback((taskKey: string) => {
    navigate(taskPath(location.pathname, taskKey))
  }, [location.pathname, location.search, navigate, section])

  const closeTicket = useCallback(() => {
    navigate({ pathname: tasksPath(location.pathname), search: (location.state as { taskListSearch?: string } | null)?.taskListSearch ?? '' })
  }, [location.pathname, location.search, location.state, navigate])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      // Text entry only: a focused checkbox or button shouldn't swallow shortcuts like Esc.
      const typing = (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(target.type)) || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable
      const dialog = !!document.querySelector('dialog[open], [aria-modal="true"]')
      if (event.key === 'Escape' && useCalendar.getState().picker) return
      if (event.key === 'Escape' && ticketParam && !typing && !dialog) { closeTicket(); return }
      if (event.key === 'Escape' && !typing && useCalendar.getState().selection.length) { useCalendar.getState().clearSelection(); return }
      if (event.key === 'Escape' && expanded && !dialog) { setExpanded(false); return }
      if (event.key === 'Escape' && view === 'day' && !typing && !dialog) { showMonth(); return }
      if (typing || dialog || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus() }
      if (event.key === 'c' && !ticketParam) {
        event.preventDefault()
        if (view === 'board') setCreateIn(workflow.firstTodo)
        else { setSelectedDayForNewTask(section === 'tasks' ? '' : cursor); setComposing(true) }
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
    <div className="cal" data-surface={section} data-expanded={expanded || undefined}>
      {!pageTaskKey && <>
      {(() => {
        const newTask = () => {
          if (view === 'board') { setCreateIn(workflow.firstTodo); return }
          setSelectedDayForNewTask(section === 'tasks' ? '' : cursor)
          setComposing(true)
        }
        const extras = (
          <>
            {datedView && <button type="button" className="section-add-btn" onClick={() => setLoggingAcc(true)}>Log work</button>}
            <ForYou workspaceId={workspaceId} onOpenTask={openTicketKey} />
            {canManage && (view === 'board' || view === 'table') && (
              <button type="button" className="section-add-btn" onClick={() => setEditingWorkflow(true)}>Workflow</button>
            )}
          </>
        )
        // Tasks is a shared collection (redesign D9); Board and Calendar are their own canvases.
        return section === 'tasks' ? (
          <CollectionHeader
            collection="tasks"
            count={tasks.length}
            onNew={newTask}
            actions={<>{extras}<button type="button" className="section-add-btn" onClick={() => setImporting(true)}>Import</button></>}
          />
        ) : (
          <SectionHeader title={sectionTitle} level={section === 'table' ? 2 : 1} newLabel="task" onNew={newTask} onImport={() => setImporting(true)}>
            {extras}
          </SectionHeader>
        )
      })()}

      {local.count + local.logCount > 0 && (
        <div className="cal-banner" role="status">
          <span>
            {[local.count && `${local.count} ${local.count === 1 ? 'task' : 'tasks'}`, local.logCount && `${local.logCount} work ${local.logCount === 1 ? 'entry' : 'entries'}`].filter(Boolean).join(' and ')}{' '}
            {local.count + local.logCount === 1 ? 'is' : 'are'} saved only in this browser.
            {local.state === 'failed' && ' Moving them failed; try again.'}
          </span>
          <button type="button" className="cal-btn" data-primary="" disabled={local.state === 'moving'} onClick={() => void local.move()}>
            {local.state === 'moving' ? 'Moving…' : 'Move to workspace'}
          </button>
          <button type="button" className="cal-btn" disabled={local.state === 'moving'} onClick={() => { if (window.confirm('Discard what is saved in this browser?')) local.discard() }}>
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
          </div> : section === 'tasks' ? null : <h2 className="cal-period">{view === 'backlog' ? 'Open tasks · all dates' : view === 'table' ? 'All tasks' : view === 'reports' ? 'Reports' : 'Board · all tasks'}</h2>}
          <span className="cal-live" data-state={sync.live} role="status" title={sync.live === 'live' ? 'Changes from teammates appear as they happen' : 'Reconnecting; changes appear when the connection is back'}>
            {sync.live === 'live' ? 'Live' : sync.live === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
          </span>
          <div className="cal-tools">
            <div className="cal-view-toggle" role="group" aria-label={`${sectionTitle} view`}>
              {views.length > 1 && views.map((v) => (
                <button key={v.id} type="button" className={`cal-btn ${view === v.id ? 'cal-view-active' : ''}`} aria-pressed={view === v.id} onClick={() => setView(v.id)}>{section === 'tasks' && v.id === 'table' ? 'List' : v.label}</button>
              ))}
            </div>
          </div>
        </header>
        {/* Reports have their own date range; the board filters narrow them too. */}
        <SavedViews workspaceId={workspaceId} />
        <CalendarFilters ref={searchRef} count={filteredTasks.length} total={scopedTasks.length} scoped={scopedTasks} reports={view === 'reports'} />

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
        ) : view === 'table' ? (
          <TableView tasks={filteredTasks} onSelectTask={openTicket} filtersOn={filtersActive(filters)} onClearFilters={clearFilters} />
        ) : view === 'reports' ? (
          <ReportsView workspaceId={workspaceId} filters={filters} />
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

      </>}

      {pageTaskKey ? (
        sync.error ? <p className="cal-board-note" role="alert">Couldn’t load task. <button type="button" className="cal-btn" onClick={sync.retry}>Retry</button></p>
          : <TicketPage taskKey={pageTaskKey} onBack={closeTicket} />
      ) : ticketParam && (
        <div className="cal-panel-layer">
          <div className="cal-panel-scrim" onClick={closeTicket} aria-hidden="true" />
          <div className="cal-panel">
            <TicketPage taskKey={ticketParam} onBack={closeTicket} variant="panel" />
          </div>
        </div>
      )}

      {editingWorkflow && <WorkflowEditor workspaceId={workspaceId} onClose={() => setEditingWorkflow(false)} />}
      <BulkBar />
      <FieldPickerHost />

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
