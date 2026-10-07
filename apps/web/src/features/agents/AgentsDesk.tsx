import { useLocation, useNavigate } from 'react-router-dom'
import { useMyWorkspaces } from '@project/sdk'
import { SectionHeader } from '../work/SectionHeader'
import { DESKS, type Desk } from '../work/sections'
import { AgentCatalog } from './AgentCatalog'
import { AgentEditor } from './AgentEditor'
import { AgentList } from './AgentList'
import { AgentRiver } from './AgentRiver'
import { EventDetail } from './EventDetail'
import './agents.css'

/** Agents (docs/agents/01): manage agents on the left, the activity river on the right.
 *  Selection lives in the URL (?agent=, ?event=, ?add=1) so other places can deep-link. */
export function AgentsDesk({ onPlace }: { onPlace?: (desk: Desk) => void }) {
  const workspace = useMyWorkspaces().data?.[0] ?? null
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin'
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const agentId = params.get('agent') ?? undefined
  const eventId = params.get('event') ?? undefined
  const adding = params.get('add') === '1'

  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(location.search)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    navigate({ pathname: location.pathname, search: next.toString() })
  }

  // Senders are managed with the company settings, when that desk exists.
  const senderDesk = DESKS.find((d) => (d.id as string) === 'company')?.id
  if (!workspace) return <p className="work-empty">Join or create a workspace to set up agents.</p>
  const timeZone = workspace.timezone

  return (
    <div className="agents">
      <SectionHeader title="Agents" titleId="agents-title" level={1}>
        {canManage && !adding && (
          <button type="button" className="section-add-btn" onClick={() => go({ add: '1', agent: null })}>
            + Add agent
          </button>
        )}
      </SectionHeader>
      <div className="agents-split">
        <div className="agents-col agents-col-main">
          {adding ? (
            <AgentCatalog workspaceId={workspace.id} onCancel={() => go({ add: null })} onCreated={(id) => go({ add: null, agent: id })} />
          ) : agentId ? (
            <AgentEditor
              workspaceId={workspace.id}
              agentId={agentId}
              timeZone={timeZone}
              canManage={canManage}
              onBack={() => go({ agent: null })}
              onOpenEvent={(id) => go({ event: id })}
              onOpenSenders={senderDesk && onPlace ? () => onPlace(senderDesk) : undefined}
            />
          ) : (
            <AgentList workspaceId={workspace.id} timeZone={timeZone} canManage={canManage} onOpen={(id) => go({ agent: id })} onAdd={() => go({ add: '1' })} />
          )}
        </div>
        <div className="agents-col agents-col-river">
          {eventId ? (
            <EventDetail
              workspaceId={workspace.id}
              eventId={eventId}
              timeZone={timeZone}
              canManage={canManage}
              onBack={() => go({ event: null })}
              onOpenAgent={(id) => go({ agent: id, add: null })}
            />
          ) : (
            <AgentRiver workspaceId={workspace.id} agentId={agentId} timeZone={timeZone} onOpen={(id) => go({ event: id })} />
          )}
        </div>
      </div>
    </div>
  )
}
