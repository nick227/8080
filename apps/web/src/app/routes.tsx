import type { ReactNode } from 'react'
import { BrowserRouter, Routes as RouterRoutes, Route, useLocation, useParams } from 'react-router-dom'
import { Home } from '../views/Home'
import { Room } from '../views/Room'

// Routes switch instantly: no fade or scale between pages (redesign 00-decisions.md,
// Phase 1). The key remounts the room page per room, not per desk or task.
function AppRoutes() {
  const location = useLocation()
  return (
    <RouterRoutes location={location} key={location.pathname.match(/^\/room\/[^/]+/)?.[0] ?? location.pathname}>
      <Route path="/" element={<Page><Home /></Page>} />
      {['/room/:roomId', '/room/:roomId/tasks', '/room/:roomId/tasks/:taskKey'].map((path) => (
        <Route key={path} path={path} element={<Page><RoomWrapper /></Page>} />
      ))}
    </RouterRoutes>
  )
}

function Page({ children }: { children: ReactNode }) {
  return <div style={{ width: '100%', height: '100%' }}>{children}</div>
}

function RoomWrapper() {
  const { roomId } = useParams()
  return <Room roomId={roomId!} />
}

export function Routes() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
