import { useEffect, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useSession } from '@project/sdk'
import { PersonIcon, SearchIcon } from '../components/icons'
import { ChatControl } from './ChatControl'
import { AccountSheet } from '../features/AccountSheet'
import { Lobby } from '../features/Lobby'
import { useShell } from '../state/shell'
import { useUI } from '../state/ui'
import { useCurrentWorkspace } from '../app/workspace'
import { CommandPalette, openCommandPalette } from '../features/command/CommandPalette'
import { ForYou } from '../features/calendar/ForYou'
import { ActiveUsersWidget } from '../features/documents/ActiveUsersWidget'
import { WorkspaceSwitcher } from '../features/work/WorkspaceSwitcher'
import { BASE_PATH, taskPath } from '../features/tasks/links'
import { MobileGetAppButton } from '../features/native/GetApp'

/**
 * The one site-wide header (redesign D10, 15-site-shell.md): logo mark → workspace switcher →
 * destinations (`nav`, WorkNav on company and room pages) → search → notifications → chat →
 * avatar. One 56px row; on phones the destinations become the bottom tab bar (CSS).
 * Theme and Get App live in the avatar menu.
 */
export function StageChrome({ showLobbyOverlay = true, nav }: { showLobbyOverlay?: boolean; nav?: ReactNode }) {
  const surface = useShell((s) => s.surface)
  const accountOpen = useShell((s) => s.accountOpen)
  const toggleAccount = useShell((s) => s.toggleAccount)
  const session = useSession()
  const user = session.data?.data
  const guest = user?.isGuest ?? true
  const lobbyOpen = surface === 'lobby'
  const { workspace } = useCurrentWorkspace()
  const location = useLocation()
  const navigate = useNavigate()
  // A notice opens its task on this page's shell (room or company), else on the company's page.
  const openTask = (taskKey: string) => navigate(BASE_PATH.test(location.pathname) ? taskPath(location.pathname, taskKey) : `/c/${workspace?.id}/tasks/${encodeURIComponent(taskKey)}`)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
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
      <header className="masthead" data-nav={nav ? 'workspace' : undefined}>
        <Link to="/" className="mast-logo" aria-label="8080 home">
          <span className="mast-logo-mark" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
  <circle
    cx="8"
    cy="8"
    r="5.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
  />
</svg>
          </span>
          {!workspace && <span className="mast-logo-word">8080</span>}
        </Link>
        <WorkspaceSwitcher />
        {nav}
        <div className="mast-actions">
          {nav && <ActiveUsersWidget />}
          <button type="button" className="mast-goto" onClick={openCommandPalette} aria-label="Search" aria-keyshortcuts="Control+K Meta+K">
            <SearchIcon />
            <span className="mast-goto-text">Search…</span>
            <kbd aria-hidden>{navigator.platform.startsWith('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          {nav && workspace && <div className="mast-bell"><ForYou workspaceId={workspace.id} onOpenTask={openTask} iconOnly /></div>}
          <MobileGetAppButton />
          <ChatControl />
          <button
            type="button"
            className="mast-icon mast-account"
            data-mark="account"
            aria-label={guest ? 'Guest' : (user?.displayName ?? 'Account')}
            aria-expanded={accountOpen}
            onClick={toggleAccount}
          >
            {user?.avatarUrl ? <img className="mast-avatar" src={user.avatarUrl} alt="" />
              : guest ? <PersonIcon guest />
                : <span className="mast-initial" aria-hidden>{(user?.displayName ?? '?').trim().charAt(0).toUpperCase()}</span>}
          </button>
        </div>
      </header>
      <AccountSheet />
      <CommandPalette />
      <AnimatePresence>
        {showLobbyOverlay && lobbyOpen && (
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
