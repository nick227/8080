import { useEffect, useRef, type KeyboardEvent } from 'react'
import { ROOM_VIEWS, type RoomView } from './roomViews'

function Mark({ id }: { id: RoomView }) {
  if (id === 'you') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    )
  }
  if (id === 'gallery') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <rect x="2" y="2" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="9" y="2" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="2" y="9" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="9" y="9" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    )
  }
  if (id === 'speaker') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <rect x="2" y="2" width="3.2" height="3.2" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="6.4" y="2" width="3.2" height="3.2" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="10.8" y="2" width="3.2" height="3.2" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="2" y="6.6" width="12" height="7.2" fill="none" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    )
  }
  if (id === 'log') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="12" height="7.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="5" cy="12.6" r="0.9" fill="currentColor" />
      <circle cx="8" cy="12.6" r="0.9" fill="currentColor" />
      <circle cx="11" cy="12.6" r="0.9" fill="currentColor" />
    </svg>
  )
}

export function ViewSwitch({ value, onChange }: { value: RoomView; onChange: (view: RoomView) => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) return
    ref.current.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }, [value])

  const move = (event: KeyboardEvent, step: number) => {
    event.preventDefault()
    const index = ROOM_VIEWS.findIndex((view) => view.id === value)
    onChange(ROOM_VIEWS[(index + step + ROOM_VIEWS.length) % ROOM_VIEWS.length].id)
  }

  return (
    <div
      ref={ref}
      className="room-views"
      role="radiogroup"
      aria-label="View"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(event, 1)
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(event, -1)
      }}
    >
      {ROOM_VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          role="radio"
          aria-checked={view.id === value}
          aria-label={view.label}
          onClick={() => onChange(view.id)}
        >
          <Mark id={view.id} />
        </button>
      ))}
    </div>
  )
}
