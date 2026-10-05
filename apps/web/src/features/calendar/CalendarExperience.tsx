import { useEffect, useState } from 'react'
import { useSession } from '@project/sdk'
import { useDocuments } from '../documents/store'
import { AddTask } from './AddTask'
import { DayView } from './DayView'
import { monthName, parseDay, sameMonth, shortDay, todayKey, weekdayName } from './dates'
import { MonthView } from './MonthView'
import { taskSheets } from './sheets'
import { useCalendar } from './store'
import './calendar.css'

export function CalendarExperience() {
  const session = useSession()
  const owner = session.data?.data.displayName ?? 'You'
  const ensureDocs = useDocuments((state) => state.ensure)
  const docs = useDocuments((state) => state.docs)
  const tasks = useCalendar((state) => state.tasks)
  const cursor = useCalendar((state) => state.cursor)
  const view = useCalendar((state) => state.view)
  const showMonth = useCalendar((state) => state.showMonth)
  const showDay = useCalendar((state) => state.showDay)
  const goToday = useCalendar((state) => state.goToday)
  const shiftMonth = useCalendar((state) => state.shiftMonth)
  const add = useCalendar((state) => state.add)
  const addMany = useCalendar((state) => state.addMany)
  const toggle = useCalendar((state) => state.toggle)
  const remove = useCalendar((state) => state.remove)
  const [note, setNote] = useState<string | null>(null)
  const today = todayKey()
  const target = view === 'day' ? cursor : today
  const sheets = taskSheets(docs)
  const openInView = tasks.filter((task) => task.status === 'open' && (view === 'day' ? task.day === cursor : sameMonth(task.day, cursor))).length

  useEffect(() => { ensureDocs(owner) }, [ensureDocs, owner])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && view === 'day' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) showMonth()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showMonth, view])

  const place = (titles: string[], source: string) => {
    const count = addMany(titles, target, source)
    setNote(count ? `${count} on ${shortDay(target)}` : `Already on ${shortDay(target)}`)
  }

  return (
    <div className="cal">
      <header className="cal-head">
        {view === 'day' && <button type="button" className="cal-back" onClick={showMonth}>{monthName(cursor)}</button>}
        <h1 className="cal-month">{view === 'day' ? weekdayName(cursor) : monthName(cursor)}</h1>
        <span className="cal-year">{parseDay(cursor).getFullYear()}</span>
        {view === 'month' && <span className="cal-open-count">{openInView} open</span>}
        {view === 'month' && (
          <div className="cal-nav">
            <button type="button" onClick={() => shiftMonth(-1)}>Prev</button>
            <button type="button" onClick={() => shiftMonth(1)}>Next</button>
          </div>
        )}
        <button type="button" className="cal-today" onClick={goToday}>Today</button>
      </header>
      <AddTask
        day={target}
        sheets={sheets}
        onAdd={(title, time) => { add({ title, day: target, time }); setNote(null) }}
        onPush={(name, titles) => place(titles, name)}
        onDump={(sheet) => place(sheet.tasks, sheet.title)}
      />
      {note && <p className="cal-note" aria-live="polite">{note}</p>}
      {view === 'day' ? (
        <DayView day={cursor} today={today} tasks={tasks} onToggle={toggle} onRemove={remove} />
      ) : (
        <MonthView cursor={cursor} today={today} tasks={tasks} onOpen={showDay} onToggle={toggle} />
      )}
    </div>
  )
}
