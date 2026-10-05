import { useState } from 'react'
import { HOURS } from './dates'

export function AddTask({ onAdd }: { onAdd: (title: string, time: string | null) => void }) {
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')

  const submit = () => {
    const next = title.trim()
    if (!next) return
    onAdd(next, time || null)
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
      <select className="cal-time" value={time} aria-label="Time" onChange={(event) => setTime(event.target.value)}>
        <option value="">Anytime</option>
        {HOURS.map((hour) => <option key={hour.value} value={hour.value}>{hour.label}</option>)}
      </select>
      <button type="submit" className="cal-btn" data-primary="" disabled={!title.trim()}>Add</button>
    </form>
  )
}
