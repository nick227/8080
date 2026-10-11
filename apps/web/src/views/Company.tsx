import { useEffect, useLayoutEffect } from 'react'
import { Link } from 'react-router-dom'
import { Panel } from '../components/Panel'
import { SEO } from '../components/SEO'
import { StageChrome } from '../components/StageChrome'
import { chooseWorkspace, useCurrentWorkspace } from '../app/workspace'
import { useWorkPlace } from '../features/records/navigation'
import { TeamDesk } from '../features/team/TeamDesk'
import { OpenCompanyChannel } from '../features/company/OpenCompanyChannel'
import { CompanyChannelShell } from '../features/company/CompanyChannelShell'
import { WorkNav } from '../features/work/WorkNav'
import { CalendarPage, WorkPage } from '../features/work/WorkPage'
import { useShell } from '../state/shell'
import '../features/room/room.css'

// A company's own page (/c/:workspaceId/…, redesign 00-decisions.md §4): the same desks
// a room shows, without a room. Stream opens the company channel; no seats;
// the chat rail shows the company channel (D4).
export function Company() {
  const { workspace, loading, missing } = useCurrentWorkspace()
  const [place, setPlace, unknownDesk, redirecting] = useWorkPlace()

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
      {loading || redirecting ? (
        <p className="work-empty" role="status">Loading…</p>
      ) : missing || unknownDesk || !workspace ? (
        <div className="company-missing" role="alert">
          <h1>{unknownDesk && workspace ? 'This page doesn’t exist' : 'This company isn’t available'}</h1>
          <p>{unknownDesk && workspace ? 'Check the link, or go back to the company.' : 'It may not exist, or you may not be a member.'}</p>
          <Link to={unknownDesk && workspace ? `/c/${workspace.id}` : '/'}>{unknownDesk && workspace ? 'Go to company overview' : 'Go to the Lobby'}</Link>
        </div>
      ) : (
        <CompanyChannelShell workspaceId={workspace.id}>
          <div className="work-column company-column">
            <WorkNav desk={place} onSelect={setPlace} />
            {place === 'team' ? (
              <TeamDesk seats={[]} />
            ) : place === 'calendar' ? (
              <CalendarPage />
            ) : place === 'stream' ? (
              <OpenCompanyChannel workspaceId={workspace.id} />
            ) : (
              <WorkPage place={place} onPlace={setPlace} />
            )}
          </div>
        </CompanyChannelShell>
      )}
    </Panel>
  )
}
