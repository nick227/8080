import { useState, type FocusEvent } from 'react'
import { cleanTime, shortDay } from './dates'
import { LISTS } from './lists'
import type { TaskSheet } from './sheets'

export function AddTask({ day, sheets, onAdd, onPush, onDump }: {
  day: string
  sheets: TaskSheet[]
  onAdd: (title: string, time: string | null) => void
  onPush: (name: string, titles: string[]) => void
  onDump: (sheet: TaskSheet) => void
}) {
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [timeError, setTimeError] = useState(false)
  const [picks, setPicks] = useState(false)
  const label = shortDay(day)

  const submit = () => {
    const next = title.trim()
    if (!next) return
    const parsed = time.trim() ? cleanTime(time) : null
    if (time.trim() && !parsed) {
      setTimeError(true)
      return
    }
    setTimeError(false)
    onAdd(next, parsed)
    setTitle('')
    setTime('')
  }

  const keepPicks = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next instanceof HTMLInputElement && event.currentTarget.contains(next)) return
    if (next instanceof HTMLButtonElement && next.classList.contains('cal-pick')) return
    setPicks(false)
  }

  return (
    <div className="cal-compose" data-picks={picks ? '' : undefined} onFocus={(event) => {
      if (event.target instanceof HTMLInputElement) setPicks(true)
    }} onBlur={keepPicks}>
      <form className="cal-add" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={`Add a task for ${label}`}
          aria-label={`Add a task for ${label}`}
          autoComplete="off"
        />
        <input
          className="cal-time"
          value={time}
          onChange={(event) => { setTime(event.target.value); setTimeError(false) }}
          placeholder="Time"
          aria-label="Time"
          aria-invalid={timeError || undefined}
          autoComplete="off"
        />
        <button type="submit" disabled={!title.trim()}>Add</button>
      </form>
      {timeError && <p className="cal-warn">Use a time like 14:00 or 2pm.</p>}
      <div className="cal-lists">
        <span className="cal-onto">For {label}</span>
        {LISTS.map((list) => (
          <button key={list.id} type="button" onClick={() => onPush(list.name, list.tasks)}>{list.name}</button>
        ))}
        {sheets.map((sheet) => (
          <button key={sheet.id} type="button" onClick={() => onDump(sheet)}>{sheet.title}</button>
        ))}
      </div>
      <div className="cal-picks">
        {LISTS.flatMap((list) => list.tasks).map((task) => (
          <button key={task} type="button" className="cal-pick" onClick={() => onAdd(task, null)}>{task}</button>
        ))}
      </div>
    </div>
  )
}
