import { useMemo } from 'react'
import { useInboxItems, useInboxStream, useTeams, useWorkspaceInsights, useWorkspaceInvites, useWorkspaceMembers } from '@project/sdk'
import { Card, CardContent, CardHeader } from '../../components/ui/Card'
import { StatGrid, StatTile } from '../../components/ui/StatTile'
import { ActivityItem, ActivityList } from '../../components/ui/ActivityList'
import { BookIcon, ChartMetricsIcon, ClockIcon, SettingsIcon } from '../../components/icons'

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
      {/* At a glance Card */}
      <Card>
        <CardHeader
          icon={<ChartMetricsIcon />}
          title="At a glance"
          description="Key metrics and activity across your company."
          actions={
            <>
              <button type="button" className="ui-btn-action">
                <SettingsIcon />
                <span>Settings</span>
              </button>
              <button type="button" className="ui-btn-action">
                <BookIcon />
                <span>Vocabulary</span>
              </button>
              <button type="button" className="ui-btn-action ui-btn-accent">
                ✓ Save changes
              </button>
            </>
          }
        />
        <CardContent>
          {insights.isError ? (
            <p className="company-status" role="status">
              Couldn’t load overview.{' '}
              <button type="button" className="section-add-btn" onClick={() => void insights.refetch()}>
                Retry
              </button>
            </p>
          ) : (
            <StatGrid>
              <StatTile
                label="Open leads"
                value={insights.isLoading ? '…' : getMetric('open-leads')}
                trend="↑ 0 this week"
                trendDirection="up"
              />
              <StatTile
                label="Pipeline"
                value={insights.isLoading ? '…' : (getMetric('pipeline-value') === '—' ? '$0' : getMetric('pipeline-value'))}
                trend="No change"
                trendDirection="neutral"
              />
              <StatTile
                label="Customers"
                value={insights.isLoading ? '…' : (getMetric('customers') === '—' ? '0 - 3 new / day' : getMetric('customers'))}
              />
              <StatTile
                label="Team members"
                value={members.isLoading ? '…' : (members.data?.length ?? 1)}
                trend="↑ 0 this week"
                trendDirection="up"
              />
              <StatTile
                label="Invites"
                value={invites.isLoading ? '…' : (inviteCount ?? 0)}
                trend="—"
                trendDirection="neutral"
              />
            </StatGrid>
          )}
        </CardContent>
      </Card>

      {/* Recent activity Card */}
      <Card style={{ marginTop: 'var(--space-lg)' }}>
        <CardHeader
          icon={<ClockIcon />}
          title="Recent activity"
          description="Updates and conversations about your company."
          actions={
            <button type="button" className="ui-btn-action">
              <span>View all →</span>
            </button>
          }
        />
        <CardContent>
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
            <ActivityList>
              {items.map((item, idx) => (
                <ActivityItem
                  key={item.id}
                  icon={
                    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                      <path d="M3 8a5 5 0 0 1 8.5-3.5M13 8a5 5 0 0 1-8.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                    </svg>
                  }
                  title={item.title}
                  summary={item.summary}
                  timestamp={idx === 0 ? '2h ago' : idx === 1 ? '3h ago' : idx === 2 ? '5h ago' : '1d ago'}
                />
              ))}
            </ActivityList>
          ) : (
            <ActivityList>
              <ActivityItem
                icon={
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                    <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 3.5a1 1 0 0 1 1 1V12a1 1 0 0 1-2 0V9.5a1 1 0 0 1 1-1z" fill="currentColor" />
                  </svg>
                }
                title="The assistant spoke"
                summary="hey again Nick AAA, missed you in smoke fa."
                timestamp="2h ago"
              />
              <ActivityItem
                icon={
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                    <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 3.5a1 1 0 0 1 1 1V12a1 1 0 0 1-2 0V9.5a1 1 0 0 1 1-1z" fill="currentColor" />
                  </svg>
                }
                title="The assistant spoke"
                summary="you asked for something to watch. I regret nothing."
                timestamp="3h ago"
              />
              <ActivityItem
                icon={
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                    <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 3.5a1 1 0 0 1 1 1V12a1 1 0 0 1-2 0V9.5a1 1 0 0 1 1-1z" fill="currentColor" />
                  </svg>
                }
                title="The assistant spoke"
                summary="good start, Nick AAA. Share the link and I'll say hi to whoever shows up."
                timestamp="5h ago"
              />
              <ActivityItem
                icon={
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                    <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 3.5a1 1 0 0 1 1 1V12a1 1 0 0 1-2 0V9.5a1 1 0 0 1 1-1z" fill="currentColor" />
                  </svg>
                }
                title="The assistant spoke"
                summary="you rang, Nick AAA? 🚨"
                timestamp="1d ago"
              />
            </ActivityList>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

