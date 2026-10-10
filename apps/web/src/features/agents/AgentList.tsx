import '../documents/DocumentsList.css'
import { useAgents, type Agent } from '@project/sdk'
import { destinationsLine, scheduleLine, when } from './format'

const STATUS: Record<string, string> = { active: 'Active', paused: 'Paused', draft: 'Draft', archived: 'Archived' }
const FAMILY_LABEL: Record<string, string> = { team: 'Team', scheduled: 'Scheduled', followup: 'Follow-ups', manual: 'Manual', social: 'Social' }

export function AgentList({ workspaceId, timeZone, canManage, onOpen, onAdd }: {
  workspaceId: string
  timeZone: string
  canManage: boolean
  onOpen: (agentId: string) => void
  onAdd: () => void
}) {
  const agents = useAgents(workspaceId)
  if (agents.isLoading) return <p className="agents-status">Loading automations…</p>
  if (agents.isError) return <p className="agents-status">Couldn’t load automations.</p>
  const rows = agents.data ?? []

  return (
    <div className="docs-table-wrap" tabIndex={0} role="region" aria-label="Your automations">
      <table className="docs-table agents-list-table">
        <thead>
          <tr>
            <th scope="col"><span className="docs-sort">Name</span></th>
            <th scope="col" className="agents-col-type"><span className="docs-sort">Type</span></th>
            <th scope="col"><span className="docs-sort">Sender</span></th>
            <th scope="col"><span className="docs-sort">Schedule</span></th>
            <th scope="col"><span className="docs-sort">Recipients</span></th>
            <th scope="col" className="agents-col-channel"><span className="docs-sort">Channel</span></th>
            <th scope="col" className="agents-col-status"><span className="docs-sort">Status</span></th>
            <th scope="col"><span className="docs-sort">Attention</span></th>
            <th scope="col" className="agents-col-date"><span className="docs-sort">Delivery</span></th>
            <th scope="col" className="docs-col-action"><span className="docs-sort">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a: Agent) => {
            const familyName = FAMILY_LABEL[a.family] ?? a.family
            const scheduleText = scheduleLine(a.schedule)
            const destText = destinationsLine(a.destinations.filter((destination) => destination !== 'internal_chat')) || '—'
            const attention = [
              a.sender.status !== 'active' ? 'Sender needs attention' : '',
              a.lastEvent?.status === 'failed' ? 'Last run failed' : '',
            ].filter(Boolean).join(' · ')
            return (
              <tr key={a.id} onClick={() => onOpen(a.id)}>
                <td className="agents-cell-title" title={a.name}>{a.name}</td>
                <td>{familyName}</td>
                <td title={a.sender.label}>{a.sender.label}</td>
                <td>
                  <div className="agents-cell-text">{scheduleText || 'Manual / On-demand'}</div>
                </td>
                <td>{a.recipientCount}</td>
                <td>{destText}</td>
                <td>
                  <span className="agents-chip" data-status={a.status}>
                    {STATUS[a.status] ?? a.status}
                  </span>
                </td>
                <td className={attention ? 'agents-status-bad' : undefined} title={attention || undefined}>
                  {attention || '—'}
                </td>
                <td>
                  <div className="agents-cell-text">
                    {a.status === 'active' && a.nextEvent
                      ? when(a.nextEvent.scheduledFor, timeZone)
                      : a.status === 'paused'
                      ? 'Paused'
                      : '—'}
                  </div>
                </td>
                <td className="docs-col-action">
                  <button
                    type="button"
                    className="docs-preview-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(a.id)
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
