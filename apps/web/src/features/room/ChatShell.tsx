import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RoomView } from './roomViews'

const KEY = 'vc-chat-open'
const LEAVE_MS = 200

export const ChatVisibility = createContext(true)

// The chat button toggles closed ⇄ open. Maximize / restore toggles open ⇄ full.
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

export function ChatShell({ stage, stream, composer, view, unseenCount = 0 }: {
  stage: ReactNode
  stream: ReactNode
  composer?: ReactNode
  view: RoomView
  unseenCount?: number
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
  const toggleLabel = mode === 'closed' ? `Show chat${unseenCount > 0 ? `, ${unseenCount} unseen message${unseenCount === 1 ? '' : 's'}` : ''}` : full ? 'Restore chat' : 'Hide chat'
  const maxLabel = full ? 'Restore chat' : 'Maximize chat'

  return (
    <div className="room-chat" data-view={view} data-chat={mode} data-leaving={leaving || undefined}>
      {stage}
      <div className="room-rail" inert={mode === 'closed' ? true : undefined}>
        <ChatVisibility.Provider value={mode !== 'closed'}>
          {stream}
          {composer}
        </ChatVisibility.Provider>
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
        {mode === 'closed' ? (
          <>
            <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 11.5a8 8 0 0 1-8 8H4l-1 2V11.5a8.5 8.5 0 0 1 17 0Z" />
              <path d="M7 9h9M7 13h6" />
            </svg>
            {unseenCount > 0 && <span className="room-chat-count" aria-hidden="true">{unseenCount > 99 ? '99+' : unseenCount}</span>}
          </>
        ) : <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden>
          <path d="M8.5 2 L4.5 6 L8.5 10" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>}
      </button>
    </div>
  )
}
