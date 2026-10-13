import { useChatPanel } from '../state/chat'
import { ChatIcon } from './icons'

/** The header's chat control: the only way to show or hide the chat panel (D10). */
export function ChatControl() {
  const hosts = useChatPanel((s) => s.hosts)
  const open = useChatPanel((s) => s.mode !== 'closed')
  const unseen = useChatPanel((s) => s.unseen)
  if (hosts <= 0) return null
  const label = open ? 'Hide chat' : `Show chat${unseen > 0 ? `, ${unseen} unseen message${unseen === 1 ? '' : 's'}` : ''}`
  return (
    <button type="button" className="mast-icon mast-chat" aria-expanded={open} aria-label={label} title={label} onClick={() => useChatPanel.getState().toggle()}>
      <ChatIcon />
      <span className="mast-chat-label" aria-hidden>Chat</span>
      {unseen > 0 && !open && <span className="mast-count" aria-hidden>{unseen > 99 ? '99+' : unseen}</span>}
    </button>
  )
}
