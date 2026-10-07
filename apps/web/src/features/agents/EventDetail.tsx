import { useAgentEvent, useCancelAgentEvent } from '@project/sdk'
import { DESTINATION_LABEL, STATUS_LABEL, eventTone, when } from './format'

/** One event's frozen facts: per destination, failures and every send attempt. */
export function EventDetail({ workspaceId, eventId, timeZone, canManage, onBack, onOpenAgent }: {
  workspaceId: string
  eventId: string
  timeZone: string
  canManage: boolean
  onBack: () => void
  onOpenAgent: (agentId: string) => void
}) {
  const event = useAgentEvent(workspaceId, eventId)
  const cancel = useCancelAgentEvent(workspaceId)
  const e = event.data

  return (
    <section className="agents-detail" aria-label="Event">
      <div className="agents-bar">
        <button type="button" className="agents-back" onClick={onBack}>
          ← Activity
        </button>
      </div>
      {event.isLoading && <p className="agents-status">Loading…</p>}
      {event.isError && <p className="agents-status">Couldn’t load this event.</p>}
      {e && (
        <div className="agents-detail-body" data-tone={eventTone(e)}>
          <button type="button" className="agents-link agents-detail-name" onClick={() => onOpenAgent(e.agentId)}>
            {e.agentName}
          </button>
          <p className="agents-detail-label">{e.label}</p>
          <p className="agents-detail-status">
            <span className="agents-event-status">{eventTone(e) === 'partial' ? 'Sent with failures' : STATUS_LABEL[e.status]}</span>
            {' · '}
            {when(e.scheduledFor, timeZone)}
          </p>
          {e.failureSummary && <p className="agents-event-failure">{e.failureSummary}</p>}

          {!!e.deliveries.length && (
            <dl className="agents-facts">
              {e.deliveries.map((d) => (
                <div key={d.destination}>
                  <dt>{DESTINATION_LABEL[d.destination]}</dt>
                  <dd>
                    {d.destination === 'email'
                      ? `${d.successCount} sent${d.failureCount ? ` · ${d.failureCount} failed` : ''}${d.skippedCount ? ` · ${d.skippedCount} skipped` : ''}`
                      : d.successCount
                        ? 'Posted'
                        : d.status === 'running'
                          ? 'Posting'
                          : 'Failed'}
                  </dd>
                </div>
              ))}
              {e.sender && (
                <div>
                  <dt>Sender</dt>
                  <dd>{String((e.sender as { displayName?: string }).displayName ?? '')}</dd>
                </div>
              )}
            </dl>
          )}

          {canManage && (e.status === 'scheduled' || e.status === 'running') && (
            <button type="button" className="agents-button agents-button-quiet" disabled={cancel.isPending} onClick={() => void cancel.mutateAsync(e.id)}>
              {e.status === 'running' ? 'Stop' : 'Cancel this send'}
            </button>
          )}

          {!!e.issues.length && (
            <div className="agents-issues">
              <h3 className="agents-label">Failures</h3>
              <ul>
                {e.issues.map((i, n) => (
                  <li key={n}>
                    <span className="agents-issue-who">{i.destination === 'internal_chat' ? 'Company chat' : i.address}</span>
                    <span className="agents-issue-why">{i.failureMessage ?? i.status}</span>
                    {i.attempts.length > 1 && <span className="agents-issue-tries">{`${i.attempts.length} attempts`}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {e.preview.chat && (
            <div className="agents-preview-block">
              <h3 className="agents-label">Company chat</h3>
              <pre className="agents-chat">{e.preview.chat}</pre>
            </div>
          )}
          {e.preview.html ? (
            <div className="agents-preview-block">
              <h3 className="agents-label">Email · {e.preview.subject}</h3>
              <iframe className="agents-frame" title="Email as sent" sandbox="" srcDoc={e.preview.html} />
            </div>
          ) : e.preview.text ? (
            <div className="agents-preview-block">
              <h3 className="agents-label">Email · {e.preview.subject}</h3>
              <pre className="agents-chat">{e.preview.text}</pre>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
