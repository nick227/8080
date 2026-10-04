import { useState, type ReactNode } from 'react'
import type { RoomView } from './roomViews'

const KEY = 'vc-chat-open'

function loadOpen() {
  try { return localStorage.getItem(KEY) !== 'closed' } catch { return true }
}

function saveOpen(open: boolean) {
  try { localStorage.setItem(KEY, open ? 'open' : 'closed') } catch { /* the choice still applies for this visit */ }
}

export function ChatShell({ header, stage, stream, view }: {
  header: ReactNode
  stage: ReactNode
  stream: ReactNode
  view: RoomView
}) {
  const [open, setOpen] = useState(loadOpen)
  const toggle = () => setOpen((current) => {
    saveOpen(!current)
    return !current
  })

  return (
    <div className="room-chat" data-view={view} data-chat={open ? 'open' : 'closed'}>
      {header}
      {stage}
      <div className="room-rail" inert={open ? undefined : true}>{stream}</div>
      <button type="button" className="room-chat-toggle" aria-expanded={open} aria-label={open ? 'Hide chat' : 'Show chat'} onClick={toggle}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M6.5 2 L3.5 5 L6.5 8" fill="none" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      </button>
    </div>
  )
}
