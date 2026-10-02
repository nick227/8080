import { useShell } from '../state/shell'

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
      <a href="/" aria-current="page" onClick={(e) => e.preventDefault()}>Lobby</a>
    </nav>
  )
}

function ConversationCrumb() {
  const room = useShell((s) => s.room)
  if (!room) return null

  return (
    <nav className="crumb" aria-label="Conversation">
      <a href="/" onClick={(e) => { e.preventDefault(); useShell.getState().toggleLobby() }}>LOBBY</a>
      <span className="crumb-sep">/</span>
      <span className="crumb-title">{room.title}</span>
    </nav>
  )
}
