import { useLocation, useNavigate } from 'react-router-dom'
import { SectionHeader } from '../work/SectionHeader'
import { DESKS, type Desk } from '../work/sections'
import { AgentCatalog } from './AgentCatalog'
import { AgentEditor } from './AgentEditor'
import { AgentList } from './AgentList'
import { AgentRiver } from './AgentRiver'
import { EventDetail } from './EventDetail'
import './agents.css'
import { useCurrentWorkspace } from '../../app/workspace'

/** Agents (docs/agents/01): full-width management + detailed history data tables.
 *  Selection lives in the URL (?agent=, ?event=, ?add=1) so other places can deep-link. */
export function AgentsDesk({ onPlace }: { onPlace?: (desk: Desk) => void }) {
  const { workspace } = useCurrentWorkspace()
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

  // Senders are managed with the company settings
  const senderDesk = DESKS.find((d) => (d.id as string) === 'company')?.id
  if (!workspace) return <p className="work-empty">Join or create a workspace to set up agents.</p>
  const timeZone = workspace.timezone

  return (
    <div className="agents">
      <SectionHeader title="Agents" titleId="agents-title" level={1}>
        {canManage && !adding && !agentId && !eventId && (
          <button type="button" className="section-add-btn" onClick={() => go({ add: '1', agent: null })}>
            + Add agent
          </button>
        )}
      </SectionHeader>
      <div className="agents-full-width">
        {adding ? (
          <AgentCatalog recipientConfig={params.get('contactIds') ? { source: 'SELECTED_CONTACTS', ids: params.get('contactIds')!.split(',') } : undefined} workspaceId={workspace.id} onCancel={() => go({ add: null })} onCreated={(id) => go({ add: null, agent: id, contactIds: null })} />
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
        ) : eventId ? (
          <EventDetail
            workspaceId={workspace.id}
            eventId={eventId}
            timeZone={timeZone}
            canManage={canManage}
            onBack={() => go({ event: null })}
            onOpenAgent={(id) => go({ agent: id, add: null })}
          />
        ) : (
          <div className="agents-tables-stack">
            <section className="agents-section" aria-labelledby="agents-list-title">
              <AgentList workspaceId={workspace.id} timeZone={timeZone} canManage={canManage} onOpen={(id) => go({ agent: id })} onAdd={() => go({ add: '1' })} />
            </section>
            <section className="agents-section" aria-labelledby="agents-activity-title" style={{ marginTop: '2rem' }}>
              <AgentRiver workspaceId={workspace.id} timeZone={timeZone} onOpen={(id) => go({ event: id })} />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
