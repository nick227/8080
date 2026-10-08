import '../documents/DocumentsList.css'
import { useAgentEvents, type AgentEventSummary } from '@project/sdk'
import { STATUS_LABEL, eventTone, when } from './format'

export function AgentRiver({ workspaceId, agentId, timeZone, onOpen }: { workspaceId: string; agentId?: string; timeZone: string; onOpen: (eventId: string) => void }) {
  const events = useAgentEvents(workspaceId, agentId)
  const rows = events.data?.pages.flatMap((p) => p.data) ?? []

  return (
    <section className="agents-river" aria-labelledby="agents-activity-title">
      <div className="agents-river-header">
        <h2 id="agents-activity-title" className="agents-label">
          {agentId ? 'History' : 'Activity'}
        </h2>
      </div>

      {events.isLoading && <p className="agents-status">Loading activity history…</p>}
      {events.isError && <p className="agents-status">Couldn’t load activity history.</p>}

      {rows.length > 0 && (
        <div className="docs-table-wrap" tabIndex={0} role="region" aria-label="Agent activity">
          <table className="docs-table agents-activity-table">
            <thead>
              <tr>
                <th scope="col" className="agents-col-status"><span className="docs-sort">Status</span></th>
                <th scope="col"><span className="docs-sort">Name</span></th>
                <th scope="col" className="agents-col-date"><span className="docs-sort">Scheduled</span></th>
                <th scope="col"><span className="docs-sort">Summary</span></th>
                <th scope="col"><span className="docs-sort">Results</span></th>
                <th scope="col" className="docs-col-action"><span className="docs-sort">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e: AgentEventSummary) => {
                const tone = eventTone(e)
                const hasFailures = e.status === 'failed' || e.counts.failed > 0
                return (
                  <tr key={e.id} data-tone={tone} onClick={() => onOpen(e.id)}>
                    <td>
                      <span className="agents-status-badge" data-tone={tone}>
                        {tone === 'partial' ? 'Partial Fail' : STATUS_LABEL[e.status] ?? e.status}
                      </span>
                    </td>
                    <td className="agents-td-main">
                      <div className="agents-cell-title">{e.agentName}</div>
                    </td>
                    <td>
                      <div className="agents-cell-text">{when(e.scheduledFor, timeZone)}</div>
                    </td>
                    <td>
                      <div className="agents-cell-text">{e.label}</div>
                    </td>
                    <td>
                      {hasFailures && e.failureSummary ? (
                        <div className="agents-status-bad" style={{ fontSize: 'var(--text-xs)' }}>{e.failureSummary}</div>
                      ) : (
                        <div className="agents-cell-text">
                          {`${e.counts.sent} sent${e.counts.failed ? `, ${e.counts.failed} failed` : ''}${e.counts.skipped ? `, ${e.counts.skipped} skipped` : ''}`}
                        </div>
                      )}
                    </td>
                    <td className="docs-col-action">
                      <button
                        type="button"
                        className="docs-preview-btn"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          onOpen(e.id)
                        }}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {events.hasNextPage && (
        <div style={{ marginTop: '1rem' }}>
          <button type="button" className="agents-more" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
            {events.isFetchingNextPage ? 'Loading more history…' : 'Load older history'}
          </button>
        </div>
      )}
    </section>
  )
}
