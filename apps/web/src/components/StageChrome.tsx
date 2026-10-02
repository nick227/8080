import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useSession } from '@project/sdk'
import { Breadcrumb } from '../components/Breadcrumb'
import { LobbyIcon, PersonIcon } from '../components/icons'
import { AccountSheet } from '../features/AccountSheet'
import { Lobby } from '../features/Lobby'
import { useShell } from '../state/shell'
import { useUI } from '../state/ui'

export function StageChrome() {
  const surface = useShell((s) => s.surface)
  const accountOpen = useShell((s) => s.accountOpen)
  const toggleLobby = useShell((s) => s.toggleLobby)
  const toggleAccount = useShell((s) => s.toggleAccount)
  const session = useSession()
  const user = session.data?.data
  const guest = user?.isGuest ?? true
  const lobbyOpen = surface === 'lobby'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const shell = useShell.getState()
      const busy = useUI.getState().state
      if (shell.accountOpen) useShell.setState({ accountOpen: false })
      else if (shell.surface === 'lobby') shell.toggleLobby()
      else if (shell.surface === 'record' && busy !== 'recording' && busy !== 'reviewing' && busy !== 'composing') shell.minimizeRecord()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <header className="masthead">
        <Link to="/" className="mast-icon" aria-label="Lobby" onClick={() => useShell.getState().showLobby()}>
          <LobbyIcon />
        </Link>
        <p className="mast">
          <span className="mast-mark" aria-hidden />
          8080
        </p>
        <button
          type="button"
          className="mast-icon"
          data-mark="account"
          aria-label={guest ? 'Guest' : (user?.displayName ?? 'Account')}
          aria-expanded={accountOpen}
          onClick={toggleAccount}
        >
          {user?.avatarUrl ? <img className="mast-avatar" src={user.avatarUrl} alt="" /> : <PersonIcon guest={guest} />}
        </button>
      </header>
      <Breadcrumb />
      <AccountSheet />
      <AnimatePresence>
        {lobbyOpen && (
          <motion.div
            key="lobby"
            className="lobby-sheet"
            role="dialog"
            aria-label="Lobby"
            initial={{ opacity: 0, y: -18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ type: 'spring', stiffness: 170, damping: 24, mass: 0.85 }}
          >
            <Lobby />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
