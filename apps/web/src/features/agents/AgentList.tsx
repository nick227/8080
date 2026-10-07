import { useAgents } from '@project/sdk'
import { destinationsLine, scheduleLine, when } from './format'

const STATUS: Record<string, string> = { active: 'Active', paused: 'Paused', draft: 'Draft', archived: 'Archived' }

export function AgentList({ workspaceId, timeZone, canManage, onOpen, onAdd }: {
  workspaceId: string
  timeZone: string
  canManage: boolean
  onOpen: (agentId: string) => void
  onAdd: () => void
}) {
  const agents = useAgents(workspaceId)
  if (agents.isLoading) return <p className="agents-status">Loading…</p>
  if (agents.isError) return <p className="agents-status">Couldn’t load agents.</p>
  const rows = agents.data ?? []
  if (!rows.length)
    return (
      <div className="agents-empty">
        <p>No agents yet. An agent sends something for you on a schedule — like a short team brief every morning.</p>
        {canManage && (
          <button type="button" className="agents-button" onClick={onAdd}>
            Add agent
          </button>
        )}
      </div>
    )

  return (
    <ul className="agents-list" aria-label="Agents">
      {rows.map((a) => (
        <li key={a.id}>
          <button type="button" className="agents-row" onClick={() => onOpen(a.id)}>
            <span className="agents-row-head">
              <span className="agents-row-name">{a.name}</span>
              <span className="agents-chip" data-status={a.status}>
                {STATUS[a.status]}
              </span>
            </span>
            <span className="agents-row-meta">
              {[scheduleLine(a.schedule), destinationsLine(a.destinations)].filter(Boolean).join(' · ')}
            </span>
            <span className="agents-row-meta">
              {`${a.recipientCount} team ${a.recipientCount === 1 ? 'member' : 'members'}`}
              {a.status === 'active' && a.nextEvent ? ` · Next: ${when(a.nextEvent.scheduledFor, timeZone)}` : ''}
              {a.lastEvent?.status === 'failed' ? ' · Last run failed' : ''}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
