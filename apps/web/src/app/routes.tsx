import type { ReactNode } from 'react'
import { BrowserRouter, Routes as RouterRoutes, Route, useLocation, useParams } from 'react-router-dom'
import { useSession } from '@project/sdk'
import { Conversations } from '../views/Conversations'
import { Workspaces, NewWorkspace } from '../views/Workspaces'
import { AppShell } from './AppShell'
import { BlueprintCatalog } from '../features/blueprints/BlueprintCatalog'
import { BlueprintReader } from '../features/blueprints/BlueprintReader'
import { Home } from '../views/Home'
import { Room } from '../views/Room'
import { Company } from '../views/Company'
import { Invite } from '../views/Invite'
import { Account } from '../views/Account'

// Routes switch instantly: no fade or scale between pages (redesign 00-decisions.md,
// Phase 1). The key remounts a room or company page per room/company, not per desk or task.
function AppRoutes() {
  const location = useLocation()
  return (
    <RouterRoutes location={location}>
      <Route element={<AppShell />} >
        <Route path="/" element={<Page publicPage><Home /></Page>} />
        <Route path="/blueprints" element={<Page publicPage><BlueprintCatalog /></Page>} />
        <Route path="/blueprints/:slug" element={<Page publicPage><BlueprintReader /></Page>} />
      <Route path="/workspaces" element={<Page publicPage><Workspaces /></Page>} />
      <Route path="/workspaces/new" element={<Page publicPage><NewWorkspace /></Page>} />
      <Route path="/conversations" element={<Page><Conversations /></Page>} />
      <Route path="/account" element={<Page><Account /></Page>} />
      </Route>
      <Route path="/invite/:token" element={<Page><Invite /></Page>} />
      {['/room/:roomId', '/room/:roomId/tasks', '/room/:roomId/tasks/:taskKey'].map((path) => (
        <Route key={path} path={path} element={<Page><RoomWrapper /></Page>} />
      ))}
      {['/c/:workspaceId', '/c/:workspaceId/:desk', '/c/:workspaceId/tasks/:taskKey'].map((path) => (
        <Route key={path} path={path} element={<Page><CompanyWrapper /></Page>} />
      ))}
    </RouterRoutes>
  )
}

function Page({ children, publicPage = false }: { children: ReactNode; publicPage?: boolean }) {
  const session = useSession()
  if (!publicPage && session.isError) return <p role="alert">Unable to start a session. <button onClick={() => void session.refetch()}>Retry</button></p>
  if (!publicPage && !session.data) return <p role="status">Loading…</p>
  return <div style={{ width: '100%', height: '100%' }}>{children}</div>
}

function RoomWrapper() {
  const { roomId } = useParams()
  return <Room key={roomId} roomId={roomId!} />
}

function CompanyWrapper() {
  const { workspaceId } = useParams()
  return <Company key={workspaceId} />
}

export function Routes() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
