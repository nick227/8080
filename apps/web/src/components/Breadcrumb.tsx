import { ChevronIcon } from './icons'
import { useShell } from '../state/shell'
import { useUI } from '../state/ui'

const seq = (n: number) => String(n).padStart(3, '0')

export function Breadcrumb() {
  const surface = useShell((s) => s.surface)
  const room = useShell((s) => s.room)
  if (surface === 'record') return null
  if (surface === 'lobby') return <LobbyCrumb />
  if (surface === 'conversation' && room) return <ConversationCrumb />
  return null
}

function LobbyCrumb() {
  return (
    <nav className="crumb" aria-label="Place">
      <a href="/?lobby=1" aria-current="page" onClick={(e) => e.preventDefault()}>Lobby</a>
    </nav>
  )
}

function ConversationCrumb() {
  const room = useShell((s) => s.room)
  if (!room) return null

  const toggle = () => {
    const shell = useShell.getState()
    if (useUI.getState().state === 'playback') useUI.getState().setIdle()
    shell.openRecord()
  }

  return (
    <nav className="crumb" aria-label="Conversation">
      <a href="/?lobby=1" onClick={(e) => { e.preventDefault(); useShell.getState().toggleLobby() }}>LOBBY</a>
      <span className="crumb-sep">/</span>
      <span className="crumb-title">{room.title}</span>
      {room.visibility && <span className="crumb-vis">{room.visibility.toUpperCase()}</span>}
    </nav>
  )
}
