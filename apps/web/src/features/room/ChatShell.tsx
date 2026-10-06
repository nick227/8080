import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RoomView } from './roomViews'

const KEY = 'vc-chat-open'
const LEAVE_MS = 200

// The chevron toggles closed ⇄ open. Maximize / restore toggles open ⇄ full.
type ChatMode = 'closed' | 'open' | 'full'

function loadMode(): ChatMode {
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'closed' || saved === 'full' ? saved : 'open'
  } catch { return 'open' }
}

function saveMode(mode: ChatMode) {
  try { localStorage.setItem(KEY, mode) } catch { /* the choice still applies for this visit */ }
}

export function ChatShell({ stage, stream, composer, view }: {
  stage: ReactNode
  stream: ReactNode
  composer?: ReactNode
  view: RoomView
}) {
  const [mode, setMode] = useState<ChatMode>(loadMode)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const change = useCallback((next: ChatMode) => { saveMode(next); setMode(next) }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Leaving full plays the collapse animation, then lands on the open panel.
  const restore = useCallback(() => {
    if (timer.current) return
    setLeaving(true)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      setLeaving(false)
      change('open')
    }, LEAVE_MS)
  }, [change])

  // Escape always steps back out of full, so the chat never traps anyone.
  useEffect(() => {
    if (mode !== 'full') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      restore()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, restore])

  const full = mode === 'full'
  const toggleLabel = mode === 'closed' ? 'Show chat' : full ? 'Restore chat' : 'Hide chat'
  const maxLabel = full ? 'Restore chat' : 'Maximize chat'

  return (
    <div className="room-chat" data-view={view} data-chat={mode} data-leaving={leaving || undefined}>
      {stage}
      <div className="room-rail" inert={mode === 'closed' ? true : undefined}>
        {stream}
        {composer}
        <button
          type="button"
          className="room-chat-max"
          aria-label={maxLabel}
          title={maxLabel}
          onClick={() => (full ? restore() : change('full'))}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4">
            {full ? (
              <path d="M12 6H8V2 M2 8h4v4 M8 6l4-4 M6 8l-4 4" />
            ) : (
              <path d="M8 2h4v4 M6 12H2V8 M12 2L8 6 M2 12l4-4" />
            )}
          </svg>
        </button>
      </div>
      <button
        type="button"
        className="room-chat-toggle"
        aria-expanded={mode !== 'closed'}
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={() => {
          if (full) restore()
          else change(mode === 'closed' ? 'open' : 'closed')
        }}
      >
        <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden>
          <path d="M8.5 2 L4.5 6 L8.5 10" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </div>
  )
}
