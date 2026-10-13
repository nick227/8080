import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useChatPanel, type ChatMode } from '../../state/chat'
import type { RoomView } from './roomViews'

const LEAVE_MS = 200

export const ChatVisibility = createContext(true)

// The header's chat control toggles closed ⇄ open (state/chat.ts). Maximize / restore toggles open ⇄ full.
export function ChatShell({ stage, stream, composer, view, unseenCount = 0 }: {
  stage: ReactNode
  stream: ReactNode
  composer?: ReactNode
  view: RoomView
  unseenCount?: number
}) {
  const mode = useChatPanel((s) => s.mode)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const change = useCallback((next: ChatMode) => useChatPanel.getState().setMode(next), [])

  useEffect(() => () => window.clearTimeout(timer.current), [])
  // While mounted, the header shows the chat control (with this room's unseen count).
  useEffect(() => {
    useChatPanel.setState((s) => ({ hosts: s.hosts + 1 }))
    return () => useChatPanel.setState((s) => ({ hosts: s.hosts - 1, unseen: 0 }))
  }, [])
  useEffect(() => { useChatPanel.setState({ unseen: unseenCount }) }, [unseenCount])

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
    </div>
  )
}
