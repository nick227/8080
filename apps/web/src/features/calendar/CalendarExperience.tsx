import { useEffect, useState } from 'react'
import { DayView } from './DayView'
import { dayTitle, monthName, parseDay, todayKey } from './dates'
import { ImportModal } from './ImportModal'
import { MonthView } from './MonthView'
import { useCalendar } from './store'
import './calendar.css'

export function CalendarExperience() {
  const tasks = useCalendar((state) => state.tasks)
  const cursor = useCalendar((state) => state.cursor)
  const view = useCalendar((state) => state.view)
  const showMonth = useCalendar((state) => state.showMonth)
  const showDay = useCalendar((state) => state.showDay)
  const goToday = useCalendar((state) => state.goToday)
  const shiftMonth = useCalendar((state) => state.shiftMonth)
  const add = useCalendar((state) => state.add)
  const importTasks = useCalendar((state) => state.importTasks)
  const toggle = useCalendar((state) => state.toggle)
  const remove = useCalendar((state) => state.remove)
  const [importing, setImporting] = useState(false)
  const today = todayKey()
  const onToday = view === 'day' ? cursor === today : cursor.slice(0, 7) === today.slice(0, 7)
  const title = view === 'day' ? dayTitle(cursor) : `${monthName(cursor)} ${parseDay(cursor).getFullYear()}`
  const dayTasks = tasks.filter((task) => task.day === cursor)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement
      if (event.key === 'Escape' && view === 'day' && !typing) showMonth()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showMonth, view])

  return (
    <div className="cal">
      <header className="cal-bar">
        {view === 'day' ? (
          <button type="button" className="cal-btn" onClick={showMonth}>Back</button>
        ) : (
          <div className="cal-nav">
            <button type="button" className="cal-btn" onClick={() => shiftMonth(-1)}>Prev</button>
            <button type="button" className="cal-btn" onClick={() => shiftMonth(1)}>Next</button>
          </div>
        )}
        <h1 className="cal-title">{title}</h1>
        <div className="cal-tools">
          <button type="button" className="cal-btn" aria-pressed={onToday} onClick={goToday}>Today</button>
          <button type="button" className="cal-btn" data-primary="" onClick={() => setImporting(true)}>Import</button>
        </div>
      </header>
      {view === 'day' ? (
        <DayView
          day={cursor}
          today={today}
          tasks={dayTasks}
          onAdd={(taskTitle, time) => add({ title: taskTitle, day: cursor, time })}
          onToggle={toggle}
          onRemove={remove}
        />
      ) : (
        <MonthView cursor={cursor} today={today} tasks={tasks} onOpen={showDay} />
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
