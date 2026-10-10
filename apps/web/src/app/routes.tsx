import type { ReactNode } from 'react'
import { BrowserRouter, Routes as RouterRoutes, Route, useLocation, useParams } from 'react-router-dom'
import { Home } from '../views/Home'
import { Room } from '../views/Room'
import { Company } from '../views/Company'
import { Account } from '../views/Account'
import { BASE_PATH } from '../features/tasks/links'

// Routes switch instantly: no fade or scale between pages (redesign 00-decisions.md,
// Phase 1). The key remounts a room or company page per room/company, not per desk or task.
function AppRoutes() {
  const location = useLocation()
  return (
    <RouterRoutes location={location} key={location.pathname.match(BASE_PATH)?.[0] ?? location.pathname}>
      <Route path="/" element={<Page><Home /></Page>} />
      <Route path="/account" element={<Page><Account /></Page>} />
      {['/room/:roomId', '/room/:roomId/tasks', '/room/:roomId/tasks/:taskKey'].map((path) => (
        <Route key={path} path={path} element={<Page><RoomWrapper /></Page>} />
      ))}
      {['/c/:workspaceId', '/c/:workspaceId/:desk', '/c/:workspaceId/tasks/:taskKey'].map((path) => (
        <Route key={path} path={path} element={<Page><Company /></Page>} />
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
