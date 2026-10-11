import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '@project/sdk'
import { AccountSheet } from '../AccountSheet'
import { ThemeSwitcher } from '../../components/ThemeSwitcher'
import { useShell } from '../../state/shell'
import './home.css'

export function ProductLayout({ children, community = false, headerContent }: { children: ReactNode; community?: boolean; headerContent?: ReactNode }) {
  const accountButton = useRef<HTMLButtonElement>(null)
  const session = useSession()
  const user = session.data?.data
  const accountOpen = useShell((s) => s.accountOpen)
  useLayoutEffect(() => { useShell.getState().enterRoom() }, [])
  useEffect(() => {
    if (!accountOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      useShell.setState({ accountOpen: false })
      accountButton.current?.focus()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [accountOpen])
  return (
    <div className={`product-page${community ? ' community-page' : ''}`}>
      <a className="product-skip" href="#main">Skip to content</a>
      <header className="product-header">
        <Link to="/" className="product-brand" aria-label="8080 home">8080</Link>
        {headerContent}
        <nav aria-label="Main navigation">
          {!community && <Link className="product-how" to="/">Browse</Link>}
          {community ? <Link className="community-header-create" to="/workspaces/new">+ Create workspace</Link> : <Link to="/workspaces">Workspaces</Link>}
          <ThemeSwitcher />
          {user && <button ref={accountButton} type="button" onClick={() => useShell.getState().toggleAccount()} aria-expanded={accountOpen}>{user.isGuest ? 'Sign in' : 'Your account'}</button>}
        </nav>
      </header>
      <AccountSheet />
      <main id="main" className="product-main">{children}</main>
      <footer className="product-footer"><Link to="/">8080</Link><Link to="/conversations">Browse conversations</Link></footer>
    </div>
  )
}
