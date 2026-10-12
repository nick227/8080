import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { StageChrome } from '../components/StageChrome'
import { useShell } from '../state/shell'
import '../features/home/home.css'
import '../features/blueprints/blueprints.css'
import './app-shell.css'
import '../features/blueprints/simple.css'

export function AppShell() {
  const location = useLocation()
  const main = useRef<HTMLElement>(null)

  useEffect(() => {
    if (location.pathname !== '/conversations' && location.pathname !== '/') {
      useShell.getState().enterRoom()
    }
    main.current?.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="bp-shell bp-shell-full">
      <a className="bp-skip" href="#blueprint-main">Skip to content</a>
      <StageChrome showLobbyOverlay={false} />
      <main ref={main} id="blueprint-main" className="bp-main">
        <Outlet />
      </main>
    </div>
  )
}
