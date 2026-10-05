import { useState } from 'react'
import { cleanTime } from './dates'

export function AddTask({ onAdd }: { onAdd: (title: string, time: string | null) => void }) {
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [timeError, setTimeError] = useState(false)

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

  return (
    <form className="cal-add" onSubmit={(event) => { event.preventDefault(); submit() }}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add a task"
        aria-label="Add a task"
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
      <button type="submit" className="cal-btn" data-primary="" disabled={!title.trim()}>Add</button>
      {timeError && <p className="cal-warn">Use a time like 14:00 or 2pm.</p>}
    </form>
  )
}
