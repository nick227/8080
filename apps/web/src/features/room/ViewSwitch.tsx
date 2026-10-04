import { type RoomView } from './roomViews'

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
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="1.5" y="3.5" width="13" height="9" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export function ViewSwitch({ value, onCycle, nextLabel }: { value: RoomView; onCycle: () => void; nextLabel: string }) {
  return (
    <button type="button" className="room-cycle" aria-label={nextLabel} title={`Switch to ${nextLabel}`} onClick={onCycle}>
      <Mark id={value} />
    </button>
  )
}
