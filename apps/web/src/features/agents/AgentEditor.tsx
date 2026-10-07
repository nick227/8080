import { useEffect, useState } from 'react'
import {
  useAgent,
  useAgentPreview,
  useDeleteAgent,
  usePauseAgent,
  usePublishAgent,
  useSendAgentTest,
  useUpdateAgent,
  type AgentDestination,
  type UpdateAgentInput,
} from '@project/sdk'
import { EMAIL_TEMPLATES, EMAIL_THEMES } from '@project/shared'
import { DESTINATION_LABEL, when } from './format'

const STATUS: Record<string, string> = { active: 'Active', paused: 'Paused', draft: 'Draft', archived: 'Archived' }
const DESTINATIONS: AgentDestination[] = ['email', 'internal_chat']

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** The editor shell (docs/agents/01 §3): one stable layout; the type decides the controls.
 *  Team agents: who (workspace members), how (email / company chat), when, and what. */
export function AgentEditor({ workspaceId, agentId, timeZone, canManage, onBack, onOpenEvent, onOpenSenders }: {
  workspaceId: string
  agentId: string
  timeZone: string
  canManage: boolean
  onBack: () => void
  onOpenEvent: (eventId: string) => void
  onOpenSenders?: () => void
}) {
  const query = useAgent(workspaceId, agentId)
  const preview = useAgentPreview(workspaceId, agentId)
  const update = useUpdateAgent(workspaceId, agentId)
  const publish = usePublishAgent(workspaceId, agentId)
  const pause = usePauseAgent(workspaceId, agentId)
  const remove = useDeleteAgent(workspaceId, agentId)
  const test = useSendAgentTest(workspaceId, agentId)
  const [name, setName] = useState('')
  const [tab, setTab] = useState<'email' | 'chat'>('email')
  // Choices show at once; the server's answer (or a refusal) replaces them.
  const [pending, setPending] = useState<UpdateAgentInput>({})
  const agent = query.data
  useEffect(() => setName(agent?.name ?? ''), [agent?.name])
  useEffect(() => setPending({}), [agent?.updatedAt])

  if (query.isLoading) return <p className="agents-status">Loading…</p>
  if (query.isError || !agent)
    return (
      <div className="agents-editor">
        <div className="agents-bar">
          <button type="button" className="agents-back" onClick={onBack}>
            ← Agents
          </button>
        </div>
        <p className="agents-status">This agent isn’t available.</p>
      </div>
    )

  const editable = canManage && agent.status !== 'archived'
  const save = (body: UpdateAgentInput) => {
    setPending((p) => ({ ...p, ...body }))
    void update.mutateAsync(body).catch(() => setPending({}))
  }
  const destinations = pending.destinations ?? agent.destinations
  const include = pending.include ?? agent.include
  const schedule = pending.schedule ?? agent.schedule ?? { repeat: 'daily' as const, time: '08:00' }
  const templateKey = pending.templateKey ?? agent.templateKey
  const themeKey = pending.themeKey ?? agent.themeKey
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])
  const busy = update.isPending || publish.isPending || pause.isPending || remove.isPending
  const actionError = [update, publish, pause, remove].find((m) => m.isError)?.error

  return (
    <section className="agents-editor" aria-label={agent.name}>
      <div className="agents-bar">
        <button type="button" className="agents-back" onClick={onBack}>
          ← Agents
        </button>
        <span className="agents-chip" data-status={agent.status}>
          {STATUS[agent.status]}
        </span>
      </div>

      <div className="agents-editor-head">
        <input
          className="agents-name"
          aria-label="Agent name"
          value={name}
          disabled={!editable}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== agent.name && save({ name: name.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {canManage && (
          <div className="agents-actions">
            <button type="button" className="agents-button agents-button-quiet" disabled={test.isPending} onClick={() => void test.mutateAsync().catch(() => undefined)}>
              {test.isPending ? 'Sending…' : 'Send test'}
            </button>
            {agent.status === 'active' ? (
              <button type="button" className="agents-button agents-button-quiet" disabled={busy} onClick={() => void pause.mutateAsync().catch(() => undefined)}>
                Pause
              </button>
            ) : agent.status !== 'archived' ? (
              <button type="button" className="agents-button" disabled={busy || agent.problems.length > 0} onClick={() => void publish.mutateAsync().catch(() => undefined)}>
                {agent.status === 'paused' ? 'Resume' : 'Publish'}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {test.data && (
        <p className="agents-status" role="status">
          {test.data.ok ? `Test sent to ${test.data.sentTo}.` : `Test not sent: ${test.data.error?.message ?? 'unknown error'}`}
        </p>
      )}
      {test.isError && <p className="agents-status" role="alert">{errorText(test.error, 'Test not sent.')}</p>}
      {actionError && <p className="agents-status agents-status-bad" role="alert">{errorText(actionError, 'That didn’t work.')}</p>}
      {agent.problems.length > 0 && (
        <ul className="agents-problems" aria-label="Before publishing">
          {agent.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="agents-fields">
        <h2 className="agents-label">Delivery</h2>
        <div className="agents-field">
          <span className="agents-field-name">Send to</span>
          <span>{`Workspace members · ${agent.recipientCount} ${agent.recipientCount === 1 ? 'person' : 'people'}`}</span>
        </div>
        <div className="agents-field">
          <span className="agents-field-name">Deliver by</span>
          <span className="agents-checks">
            {DESTINATIONS.map((d) => {
              const on = destinations.includes(d)
              return (
                <label key={d}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!editable || (on && destinations.length === 1)}
                    onChange={() => save({ destinations: toggle(destinations, d) })}
                  />
                  {DESTINATION_LABEL[d]}
                </label>
              )
            })}
          </span>
        </div>
        <label className="agents-field">
          <span className="agents-field-name">Repeat</span>
          <select
            value={schedule.weekdaysOnly ? 'weekdays' : 'daily'}
            disabled={!editable}
            onChange={(e) => save({ schedule: { repeat: 'daily', time: schedule.time, weekdaysOnly: e.target.value === 'weekdays' } })}
          >
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays</option>
          </select>
        </label>
        <label className="agents-field">
          <span className="agents-field-name">Time</span>
          <input
            type="time"
            step={900}
            value={schedule.time ?? '08:00'}
            disabled={!editable}
            onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && save({ schedule: { ...schedule, repeat: 'daily', time: e.target.value } })}
          />
        </label>
        <div className="agents-field">
          <span className="agents-field-name">Sender</span>
          <span>
            {agent.sender.label}
            {agent.sender.replyTo ? ` · replies to ${agent.sender.replyTo}` : ''}
            {agent.sender.status !== 'active' ? ' · needs attention' : ''}
            {onOpenSenders && (
              <>
                {' · '}
                <button type="button" className="agents-link" onClick={onOpenSenders}>
                  Change
                </button>
              </>
            )}
          </span>
        </div>
        <div className="agents-field">
          <span className="agents-field-name">Next delivery</span>
          <span>
            {agent.status === 'active' && agent.nextEvent ? (
              <button type="button" className="agents-link" onClick={() => onOpenEvent(agent.nextEvent!.id)}>
                {when(agent.nextEvent.scheduledFor, timeZone)}
              </button>
            ) : agent.status === 'active' ? (
              'None scheduled'
            ) : agent.status === 'paused' ? (
              'Paused — resume to schedule it'
            ) : (
              'After you publish'
            )}
          </span>
        </div>

        <h2 className="agents-label">Include</h2>
        <div className="agents-checks agents-checks-column">
          {agent.sections.map((s) => {
            const on = include.includes(s.key)
            const count = preview.data?.sections.find((x) => x.key === s.key)?.count
            return (
              <label key={s.key}>
                <input type="checkbox" checked={on} disabled={!editable || (on && include.length === 1)} onChange={() => save({ include: toggle(include, s.key) })} />
                {s.label}
                {on && count !== undefined && <span className="agents-count">{count} today</span>}
              </label>
            )
          })}
        </div>

        <h2 className="agents-label">Look</h2>
        <label className="agents-field">
          <span className="agents-field-name">Template</span>
          <select value={templateKey} disabled={!editable} onChange={(e) => save({ templateKey: e.target.value })}>
            {EMAIL_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="agents-field">
          <span className="agents-field-name">Theme</span>
          <select value={themeKey} disabled={!editable || templateKey === 'plain'} onChange={(e) => save({ themeKey: e.target.value })}>
            {EMAIL_THEMES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="agents-preview">
        <div className="agents-tabs" role="tablist" aria-label="Preview">
          {(['email', 'chat'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className="agents-tab" onClick={() => setTab(t)}>
              {t === 'email' ? 'Email' : 'Company chat'}
            </button>
          ))}
          <span className="agents-preview-note">As it would go out now</span>
        </div>
        {preview.isLoading && <p className="agents-status">Loading preview…</p>}
        {preview.isError && <p className="agents-status">Couldn’t build the preview.</p>}
        {preview.data &&
          (tab === 'chat' ? (
            <pre className="agents-chat">{preview.data.chat}</pre>
          ) : (
            <>
              <p className="agents-subject">{preview.data.subject}</p>
              {preview.data.html ? (
                <iframe className="agents-frame" title="Email preview" sandbox="" srcDoc={preview.data.html} />
              ) : (
                <pre className="agents-chat">{preview.data.text}</pre>
              )}
            </>
          ))}
      </div>

      {canManage && agent.status !== 'archived' && (
        <div className="agents-danger">
          <button
            type="button"
            className="agents-link agents-link-danger"
            disabled={busy}
            onClick={() => {
              const verb = agent.lastEvent ? 'Archive' : 'Delete'
              if (window.confirm(`${verb} “${agent.name}”? ${agent.lastEvent ? 'Its history stays in Activity.' : ''}`)) void remove.mutateAsync().then(onBack).catch(() => undefined)
            }}
          >
            {agent.lastEvent ? 'Archive agent' : 'Delete agent'}
          </button>
        </div>
      )}
    </section>
  )
}
