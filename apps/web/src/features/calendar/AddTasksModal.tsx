import { useEffect, useRef, useState } from 'react'
import { NOON } from './dates'

export function AddTasksModal({ day, onClose, onAdd }: {
  day: string
  onClose: () => void
  onAdd: (title: string, day: string, time: string | null) => void
}) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(day)
  const titleRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const ready = title.trim().length > 0 && date.length > 0

  useEffect(() => { titleRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const node = dialogRef.current
      if (!node) return
      const items = [...node.querySelectorAll<HTMLElement>('input, select, button:not(:disabled)')]
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = (another: boolean) => {
    if (!ready) return
    onAdd(title.trim(), date, NOON)
    if (!another) {
      onClose()
      return
    }
    setTitle('')
    titleRef.current?.focus()
  }

  return (
    <div className="cal-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="cal-dialog" role="dialog" aria-modal="true" aria-labelledby="cal-add-title">
        <h2 id="cal-add-title">Add tasks</h2>
        <form onSubmit={(event) => { event.preventDefault(); save(false) }}>
          <label className="cal-field">
            <span>Task</span>
            <input ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" />
          </label>
          <label className="cal-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <p className="cal-noon">Saves at 12:00 PM.</p>
          <div className="cal-actions">
            <button type="button" className="cal-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="cal-btn" data-primary="" disabled={!ready}>Submit</button>
            <button type="button" className="cal-btn" disabled={!ready} onClick={() => save(true)}>Submit and add another</button>
          </div>
        </form>
      </div>
    </div>
  )
}
