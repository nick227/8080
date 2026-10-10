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

/** Automations (docs/agents/01): the list is the shared collection view (redesign D9);
 *  the catalog, editor and run detail are full pages.
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
  if (!workspace) return <p className="work-empty">Join or create a company to set up automations.</p>
  const timeZone = workspace.timezone

  if (!adding && !agentId && !eventId) {
    return (
      <div className="agents">
        <AgentList
          workspaceId={workspace.id}
          timeZone={timeZone}
          canManage={canManage}
          onOpen={(id) => go({ agent: id })}
          onAdd={() => go({ add: '1', agent: null })}
          activity={(
            <section className="agents-section agents-activity" aria-labelledby="agents-activity-title">
              <AgentRiver workspaceId={workspace.id} timeZone={timeZone} onOpen={(id) => go({ event: id })} />
            </section>
          )}
        />
      </div>
    )
  }

  return (
    <div className="agents">
      <SectionHeader title="Automations" titleId="agents-title" level={1} />
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
        ) : (
          <EventDetail
            workspaceId={workspace.id}
            eventId={eventId!}
            timeZone={timeZone}
            canManage={canManage}
            onBack={() => go({ event: null })}
            onOpenAgent={(id) => go({ agent: id, add: null })}
          />
        )}
      </div>
    </div>
  )
}
