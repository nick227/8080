import { nextView, VIEW_LABEL, type RoomView } from './roomViews'

function Mark({ id }: { id: RoomView }) {
  if (id === 'person') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <rect x="3" y="2" width="10" height="12" fill="none" stroke="currentColor" strokeWidth="1.25" />
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
  if (id === 'focus') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <rect x="2" y="2" width="3" height="12" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <rect x="7" y="2" width="7" height="12" fill="none" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="3" height="3" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="6.5" y="2" width="3" height="3" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="11" y="2" width="3" height="3" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="2" y="7" width="12" height="7" fill="none" stroke="currentColor" strokeWidth="1.25" />
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
