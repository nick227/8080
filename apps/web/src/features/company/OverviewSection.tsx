import { useMemo } from 'react'
import { useInboxItems, useInboxStream, useTeams, useWorkspaceInsights, useWorkspaceInvites, useWorkspaceMembers } from '@project/sdk'
import { SectionHeader } from '../work/SectionHeader'

export function OverviewSection({ workspaceId }: { workspaceId: string }) {
  const insights = useWorkspaceInsights(workspaceId)
  const members = useWorkspaceMembers(workspaceId)
  const invites = useWorkspaceInvites(workspaceId)
  const teams = useTeams(workspaceId)
  const cards = insights.data?.cards
  const cardMap = useMemo(() => {
    if (!cards) return null
    const map = new Map<string, string>()
    for (const card of cards) {
      map.set(card.id, card.value)
    }
    return map
  }, [cards])
  const getMetric = (id: string) => cardMap?.get(id) ?? '—'

  const inviteCount = invites.isError ? null : invites.data?.length
  const notifications = useInboxItems(workspaceId, { unread: true })
  useInboxStream(workspaceId)
  const items = useMemo(
    () => notifications.data?.pages.flatMap((page) => page.data) ?? [],
    [notifications.data?.pages],
  )

  return (
    <section className="company-group" aria-labelledby="company-overview-title">
      <SectionHeader title="At a glance" titleId="company-overview-title" />
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
                  <dd>{insights.isLoading ? '…' : getMetric('open-leads')}</dd>
                </div>
                <div>
                  <dt>Pipeline</dt>
                  <dd>{insights.isLoading ? '…' : getMetric('pipeline-value')}</dd>
                </div>
                <div>
                  <dt>Customers</dt>
                  <dd>{insights.isLoading ? '…' : getMetric('customers')}</dd>
                </div>
                <div>
                  <dt>Catalog</dt>
                  <dd>{insights.isLoading ? '…' : getMetric('catalog')}</dd>
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

        </div>
      )}
      <div className="company-overview company-actions">
        <h3 id="company-notifications-title">Notifications</h3>
        <div className="company-notifications" role="region" aria-labelledby="company-notifications-title" tabIndex={0}>
      {notifications.isLoading ? (
        <p className="company-status" role="status">Loading notifications…</p>
      ) : notifications.isError ? (
        <p className="company-status" role="status">
          Couldn’t load notifications.{' '}
          <button type="button" className="section-add-btn" onClick={() => void notifications.refetch()}>
            Retry
          </button>
        </p>
      ) : items.length > 0 ? (
        <div>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <span><strong>{item.title}</strong>{item.summary && <> — {item.summary}</>}</span>
              </li>
            ))}
          </ul>
          {notifications.hasNextPage && (
            <button type="button" className="section-add-btn" disabled={notifications.isFetchingNextPage} onClick={() => void notifications.fetchNextPage()}>
              Load more
            </button>
          )}
        </div>
      ) : (
        <p className="company-status" role="status">No new notifications.</p>
      )}
        </div>
      </div>
    </section>
  )
}
