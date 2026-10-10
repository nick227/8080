import { useEffect, useLayoutEffect } from 'react'
import { Link } from 'react-router-dom'
import { Panel } from '../components/Panel'
import { SEO } from '../components/SEO'
import { StageChrome } from '../components/StageChrome'
import { chooseWorkspace, useCurrentWorkspace } from '../app/workspace'
import { useWorkPlace } from '../features/records/navigation'
import { TeamDesk } from '../features/team/TeamDesk'
import { WorkNav } from '../features/work/WorkNav'
import { CalendarPage, WorkPage } from '../features/work/WorkPage'
import { useShell } from '../state/shell'
import '../features/room/room.css'

// A company's own page (/c/:workspaceId/…, redesign 00-decisions.md §4): the same desks
// a room shows, without a room. No live floor, no seats, and (until the company channel
// is wired, D4) no chat rail.
export function Company() {
  const { workspace, loading, missing } = useCurrentWorkspace()
  const [place, setPlace, unknownDesk] = useWorkPlace()

  useLayoutEffect(() => {
    useShell.getState().enterRoom()
  }, [])
  // Opening a company makes it this browser's current one (D1).
  useEffect(() => {
    if (workspace) chooseWorkspace(workspace.id)
  }, [workspace])

  return (
    <Panel as="main" variant="shell" className="room-shell company-shell">
      <SEO title={workspace ? `${workspace.name} - 8080` : '8080'} description="Company workspace" />
      <StageChrome />
      {loading ? (
        <p className="work-empty" role="status">Loading…</p>
      ) : missing || unknownDesk || !workspace ? (
        <div className="company-missing" role="alert">
          <h1>{unknownDesk && workspace ? 'This page doesn’t exist' : 'This company isn’t available'}</h1>
          <p>{unknownDesk && workspace ? 'Check the link, or go back to the company.' : 'It may not exist, or you may not be a member.'}</p>
          <Link to={unknownDesk && workspace ? `/c/${workspace.id}` : '/'}>{unknownDesk && workspace ? 'Go to company overview' : 'Go to the Lobby'}</Link>
        </div>
      ) : (
        <div className="work-column company-column">
          {/* Stream opens the Lobby's conversations until company rooms are listed (Phase 2b). */}
          <WorkNav desk={place} teamActive={place === 'team'} onSelect={(next) => (next === 'stream' ? useShell.getState().showLobby() : setPlace(next))} />
          {place === 'team' ? (
            <TeamDesk seats={[]} />
          ) : place === 'calendar' ? (
            <CalendarPage />
          ) : place === 'stream' ? null : (
            <WorkPage place={place} onPlace={setPlace} />
          )}
        </div>
      )}
    </Panel>
  )
}
