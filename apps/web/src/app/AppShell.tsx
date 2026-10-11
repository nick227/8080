import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '@project/sdk'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
import { AccountSheet } from '../features/AccountSheet'
import { CommandPalette, openCommandPalette } from '../features/command/CommandPalette'
import { WorkspaceList } from '../features/home/WorkspaceList'
import { useShell } from '../state/shell'
import '../features/home/home.css'
import '../features/blueprints/blueprints.css'
import './app-shell.css'
import '../features/blueprints/simple.css'

function viewport() { return window.innerWidth < 768 ? 'phone' : window.innerWidth < 1200 ? 'tablet' : 'wide' }
export function AppShell() {
  const [size, setSize] = useState(viewport)
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem('8080.nav.mode') === 'compact' } catch { return false } })
  const [overlay, setOverlay] = useState(false)
  const location = useLocation()
  const toggle = useRef<HTMLButtonElement>(null)
  const rail = useRef<HTMLElement>(null)
  const main = useRef<HTMLElement>(null)
  const user = useSession().data?.data
  const accountOpen = useShell(s => s.accountOpen)
  const narrow = size !== 'wide'
  const collapsed = narrow || compact
  useEffect(() => { const resize = () => { setSize(viewport()); setOverlay(false) }; window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])
  useEffect(() => {
    setOverlay(false)
    if (location.pathname !== '/conversations') useShell.getState().enterRoom()
    main.current?.scrollTo(0, 0)
  }, [location.pathname])
  useEffect(() => {
    if (!overlay) return
    const links = () => [...(rail.current?.querySelectorAll<HTMLElement>('a, button') ?? [])]
    links()[0]?.focus()
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOverlay(false); toggle.current?.focus() }
      if (e.key === 'Tab') {
        const list = links(); const first = list[0]; const last = list.at(-1)
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown',handle); return () => window.removeEventListener('keydown',handle)
  },[overlay])
  useEffect(() => {
    if (!accountOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') useShell.setState({ accountOpen: false }) }
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close)
  },[accountOpen])
  function changeNav() {
    if (narrow) { setOverlay(v => !v); return }
    setCompact(v => { try { localStorage.setItem('8080.nav.mode', !v ? 'compact' : 'expanded') } catch { /* Memory fallback. */ } return !v })
  }
  return <div className="bp-shell" data-compact={collapsed} data-size={size} data-overlay={overlay}>
    <a className="bp-skip" href="#blueprint-main">Skip to content</a>
    <header className="bp-header">
      <div className="bp-brand-group"><button className="bp-nav-toggle" ref={toggle} onClick={changeNav} aria-label={narrow ? overlay ? 'Close navigation' : 'Open navigation' : compact ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={narrow ? overlay : !compact} aria-controls="blueprint-navigation"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M4 6h16M4 12h16M4 18h16" /></svg></button><Link to="/" className="bp-logo">8080</Link></div>
      <div className="bp-header-actions"><button className="bp-goto" onClick={openCommandPalette}>Go to… <kbd>⌘ / Ctrl K</kbd></button><ThemeSwitcher />{user && <button className="bp-account" onClick={() => useShell.getState().toggleAccount()} aria-expanded={accountOpen} aria-label={user.isGuest ? 'Sign in' : 'Your account'} title={user.isGuest ? 'Sign in' : user.displayName || 'Your account'}>{user.isGuest ? 'Sign in' : user.avatarUrl ? <img className="app-avatar" src={user.avatarUrl} alt="" /> : <span className="app-avatar">{(user.displayName || 'Account').slice(0,1).toUpperCase()}</span>}</button>}</div>
    </header>
    <AccountSheet /><CommandPalette />
    {overlay && <button className="bp-nav-backdrop" tabIndex={-1} aria-label="Close navigation" onClick={() => { setOverlay(false); toggle.current?.focus() }} />}
    <aside ref={rail} id="blueprint-navigation" className="bp-navigation" aria-label="Site navigation" inert={size === 'phone' && !overlay ? true : undefined}>
      {overlay && <button className="bp-drawer-close" onClick={() => { setOverlay(false); toggle.current?.focus() }}>Close navigation ×</button>}
      <nav>{[
        { to: '/workspaces', label: 'Workspaces', icon: '▣', active: location.pathname === '/' || location.pathname === '/workspaces' },
        { to: '/conversations', label: 'Community', icon: '☷', active: location.pathname === '/conversations' },
        { to: '/blueprints', label: 'Blueprints', icon: '▦', active: location.pathname === '/blueprints' || location.pathname.startsWith('/blueprints/') },
      ].map(item => <Link key={item.to} to={item.to} aria-label={item.label} aria-current={item.active ? 'page' : undefined} title={item.label}><span aria-hidden>{item.icon}</span><span className="bp-nav-label">{item.label}<small className="app-nav-detail">{item.detail}</small></span></Link>)}</nav>

      <div className="bp-nav-bottom"><span className="bp-nav-label">8080<br /></span></div>
    </aside>
    <main ref={main} id="blueprint-main" className="bp-main" inert={overlay ? true : undefined}><Outlet /></main>
  </div>
}
