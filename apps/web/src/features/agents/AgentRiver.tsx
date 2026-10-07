import { useAgentEvents } from '@project/sdk'
import { STATUS_LABEL, eventTone, when } from './format'

/** The activity river: upcoming, running, sent, failed and canceled events in one
 *  chronological list (latest scheduled time first), forever. */
export function AgentRiver({ workspaceId, agentId, timeZone, onOpen }: { workspaceId: string; agentId?: string; timeZone: string; onOpen: (eventId: string) => void }) {
  const events = useAgentEvents(workspaceId, agentId)
  const rows = events.data?.pages.flatMap((p) => p.data) ?? []

  return (
    <section className="agents-river" aria-labelledby="agents-activity-title">
      <h2 id="agents-activity-title" className="agents-label agents-river-title">
        {agentId ? 'Activity for this agent' : 'Activity'}
      </h2>
      {events.isLoading && <p className="agents-status">Loading…</p>}
      {events.isError && <p className="agents-status">Couldn’t load activity.</p>}
      {!events.isLoading && !rows.length && <p className="agents-status">Nothing yet. Published agents show their upcoming and past sends here.</p>}
      <ol className="agents-events">
        {rows.map((e) => (
          <li key={e.id}>
            <button type="button" className="agents-event" data-tone={eventTone(e)} onClick={() => onOpen(e.id)}>
              <span className="agents-event-when">{when(e.scheduledFor, timeZone)}</span>
              <span className="agents-event-name">{e.agentName}</span>
              <span className="agents-event-label">{e.label}</span>
              {(e.status === 'failed' || e.counts.failed > 0) && e.failureSummary && <span className="agents-event-failure">{e.failureSummary}</span>}
              <span className="agents-event-status">{eventTone(e) === 'partial' ? 'Sent with failures' : STATUS_LABEL[e.status]}</span>
            </button>
          </li>
        ))}
      </ol>
      {events.hasNextPage && (
        <button type="button" className="agents-more" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
          {events.isFetchingNextPage ? 'Loading…' : 'Older'}
        </button>
      )}
    </section>
  )
}
