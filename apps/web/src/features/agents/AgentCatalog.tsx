import type { RecipientConfig } from '@project/shared'
import { useAgentTypes, useCreateAgent } from '@project/sdk'
import '../documents/DocumentsList.css'

const FAMILY_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  followup: 'Follow-ups',
  manual: 'Manual',
  team: 'Team',
  social: 'Social',
}

const DEFAULT_SCHEDULE_HINT: Record<string, string> = {
  daily_team_brief: 'Daily at 08:00',
  daily_customer_report: 'Daily at 17:00',
  company_newsletter: 'Monthly at 09:00',
  sales_catalog: 'Monthly at 10:00',
  internal_messages: 'Weekly at 09:00',
  welcome_new_customer: 'When Contact becomes Customer',
  ask_for_review: 'After purchase / service',
  checkin_no_reply: 'On inactivity threshold',
  followup_status_change: 'On Contact status change',
  checkin_after_service: 'On service completion',
  company_announcement: 'Manual / On-demand',
  special_offer: 'Manual / On-demand',
  event_invitation: 'Manual / On-demand',
  important_notice: 'Manual / On-demand',
  new_product_launch: 'Manual / On-demand',
  weekly_social_post: 'Weekly social post',
  product_spotlight: 'Weekly social spotlight',
  company_update: 'Weekly company update',
  promotion_schedule: 'Scheduled social campaign',
  post_announcement: 'Manual / On-demand',
  promote_product: 'Manual / On-demand',
  share_with_followers: 'Manual / On-demand',
}

/** Built-in agent templates grouped by delivery channel. */
export function AgentCatalog({ workspaceId, onCancel, onCreated, recipientConfig }: {
  recipientConfig?: RecipientConfig
  workspaceId: string
  onCancel: () => void
  onCreated: (agentId: string) => void
}) {
  const types = useAgentTypes(workspaceId)
  const create = useCreateAgent(workspaceId)
  const rows = (types.data ?? []).filter(t => !recipientConfig || (['manual', 'scheduled'].includes(t.family) && t.key !== 'internal_messages'))
  const channels = [
    { name: 'Email', rows: rows.filter((type) => type.family !== 'social' && type.family !== 'team') },
    { name: 'Social', rows: rows.filter((type) => type.family === 'social') },
    { name: 'Team', rows: rows.filter((type) => type.family === 'team') },
  ]
  const createAgent = (key: string) => {
    if (create.isPending) return
    create.mutate({ typeKey: key, recipientConfig }, { onSuccess: (agent) => onCreated(agent.id) })
  }

  return (
    <section className="agents-catalog" aria-label="Add agent">
      <div className="agents-bar" style={{ marginBottom: '1rem' }}>
        <button type="button" className="agents-back" onClick={onCancel}>
          ← Back to Agents
        </button>
      </div>

      {types.isLoading && <p className="agents-status">Loading templates…</p>}
      {types.isError && <p className="agents-status">Couldn’t load agent templates.</p>}

      <div className="agents-tables-stack">
        {channels.filter((channel) => channel.rows.length > 0).map((channel) => (
          <section key={channel.name} aria-label={`${channel.name} templates`}>
            <h3 className="agents-label">{channel.name}</h3>
            <div className="docs-table-wrap" tabIndex={0} role="region" aria-label={`${channel.name} agent templates`}>
              <table className="docs-table agents-catalog-table">
                <thead>
                  <tr>
                    <th scope="col"><span className="docs-sort">Name</span></th>
                    <th scope="col" className="agents-catalog-family"><span className="docs-sort">Family</span></th>
                    <th scope="col" className="agents-catalog-schedule"><span className="docs-sort">Schedule</span></th>
                    <th scope="col" className="docs-col-action"><span className="docs-sort">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {channel.rows.map((t) => {
                    const familyName = FAMILY_LABEL[t.family] ?? t.family
                    const scheduleHint = DEFAULT_SCHEDULE_HINT[t.key] ?? (t.family === 'manual' ? 'Manual / On-demand' : 'Scheduled')
                    return (
                      <tr key={t.key} onClick={() => createAgent(t.key)}>
                        <td className="agents-cell-title" title={t.name}>{t.name}</td>
                        <td>{familyName}</td>
                        <td title={scheduleHint}>{scheduleHint}</td>
                        <td className="docs-col-action">
                          <button
                            type="button"
                            className="docs-preview-btn"
                            aria-label={`Create ${t.name}`}
                            disabled={create.isPending}
                            onClick={(e) => {
                              e.stopPropagation()
                              createAgent(t.key)
                            }}
                          >
                            + Create
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {create.isError && (
        <p className="agents-status agents-status-bad" role="alert" style={{ marginTop: '0.75rem' }}>
          {create.error instanceof Error ? create.error.message : 'Couldn’t add the agent.'}
        </p>
      )}
    </section>
  )
}
