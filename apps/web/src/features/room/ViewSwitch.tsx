import { nextView, VIEW_LABEL, type RoomView } from './roomViews'

function Mark({ id }: { id: RoomView }) {
  if (id === 'grid') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <rect x="1.5" y="1.5" width="3.5" height="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="6.25" y="1.5" width="3.5" height="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="11" y="1.5" width="3.5" height="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="1.5" y="6.25" width="3.5" height="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="6.25" y="6.25" width="3.5" height="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="11" y="6.25" width="3.5" height="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="1.5" y="11" width="3.5" height="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="6.25" y="11" width="3.5" height="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="11" y="11" width="3.5" height="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    )
  }
  if (id === 'medium') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <rect x="1.5" y="4.5" width="6" height="7" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="8.5" y="4.5" width="6" height="7" fill="none" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="1.5" y="3.5" width="13" height="9" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export function ViewSwitch({ value, onChange }: { value: RoomView; onChange: (view: RoomView) => void }) {
  const next = nextView(value)
  return (
    <button type="button" className="room-cycle" aria-label={VIEW_LABEL[next]} onClick={() => onChange(next)}>
      <Mark id={value} />
    </button>
  )
}
