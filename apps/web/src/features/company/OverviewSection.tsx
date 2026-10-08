import {
  useInboxItems,
  useInboxStream,
  useTeams,
  useWorkspaceInsights,
  useWorkspaceInvites,
  useWorkspaceMembers,
} from '@project/sdk'
import { SectionHeader } from '../work/SectionHeader'
import type { DeskLink } from './links'

type Action = { id: string; label: string; go: string; link: DeskLink }

function metric(cards: { id: string; value: string }[] | undefined, id: string) {
  return cards?.find((c) => c.id === id)?.value ?? '—'
}

export function OverviewSection({
  workspaceId,
  onLink,
}: {
  workspaceId: string
  onLink: (link: DeskLink) => void
}) {
  const insights = useWorkspaceInsights(workspaceId)
  const members = useWorkspaceMembers(workspaceId)
  const invites = useWorkspaceInvites(workspaceId)
  const teams = useTeams(workspaceId)
  const unread = useInboxItems(workspaceId, { unread: true })
  useInboxStream(workspaceId)

  const cards = insights.data?.cards
  const inviteCount = invites.isError ? null : invites.data?.length
  const unreadCount = unread.data?.pages.flatMap((page) => page.data).length ?? 0

  const actions: Action[] = []
  for (const row of insights.data?.attention ?? []) {
    if (row.id === 'overdue-followups') {
      actions.push({ id: row.id, label: row.label, go: 'Open Contacts', link: row.href })
    } else if (row.id === 'low-stock-attn') {
      actions.push({ id: row.id, label: row.label, go: 'Open Inventory', link: row.href })
    }
  }
  if (inviteCount != null && inviteCount > 0) {
    actions.push({
      id: 'invites',
      label: `${inviteCount} pending invite${inviteCount === 1 ? '' : 's'}`,
      go: 'Open Team',
      link: { desk: 'team' },
    })
  }
  if (unreadCount > 0) {
    actions.push({
      id: 'unread',
      label: `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`,
      go: 'Open Calendar',
      link: { desk: 'calendar' },
    })
  }

  return (
    <section className="company-group" aria-labelledby="company-overview-title">
      <SectionHeader title="Overview" titleId="company-overview-title" />

      {insights.isError ? (
        <p className="company-status" role="status">
          Couldn’t load overview.{' '}
          <button type="button" className="section-add-btn" onClick={() => void insights.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <div className="company-overview">
          <div className="company-metrics">
            <div>
              <h3>Sales</h3>
              <dl>
                <div>
                  <dt>Open leads</dt>
                  <dd>{insights.isLoading ? '…' : metric(cards, 'open-leads')}</dd>
                </div>
                <div>
                  <dt>Pipeline</dt>
                  <dd>{insights.isLoading ? '…' : metric(cards, 'pipeline-value')}</dd>
                </div>
                <div>
                  <dt>Customers</dt>
                  <dd>{insights.isLoading ? '…' : metric(cards, 'customers')}</dd>
                </div>
                <div>
                  <dt>Catalog</dt>
                  <dd>{insights.isLoading ? '…' : metric(cards, 'catalog')}</dd>
                </div>
              </dl>
            </div>
            <div>
              <h3>Team</h3>
              <dl>
                <div>
                  <dt>Members</dt>
                  <dd>{members.isLoading ? '…' : (members.data?.length ?? '—')}</dd>
                </div>
                <div>
                  <dt>Invites</dt>
                  <dd>{invites.isLoading ? '…' : (inviteCount ?? '—')}</dd>
                </div>
                <div>
                  <dt>Teams</dt>
                  <dd>{teams.isLoading ? '…' : (teams.data?.length ?? '—')}</dd>
                </div>
              </dl>
            </div>
          </div>

          {actions.length > 0 && (
            <div className="company-actions">
              <h3>Action needed</h3>
              <ul>
                {actions.map((row) => (
                  <li key={row.id}>
                    <span>{row.label}</span>
                    <button type="button" className="company-go" onClick={() => onLink(row.link)}>
                      {row.go}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
