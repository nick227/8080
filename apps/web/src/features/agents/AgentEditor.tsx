import { AudienceEditor } from './AudienceEditor'
import { useEffect, useState } from 'react'
import {
  useAgent,
  useAgentPreview,
  useCreateEmailConnection,
  useDeleteAgent,
  useEmailConnections,
  usePauseAgent,
  usePublishAgent,
  useSendAgentTest,
  useUpdateAgent,
  type AgentDestination,
  type CreateEmailConnectionInput,
  type UpdateAgentInput,
} from '@project/sdk'
import { EMAIL_TEMPLATES, EMAIL_THEMES, MERGE_FIELDS } from '@project/shared'
import { DESTINATION_LABEL, when } from './format'
import { TestEmailSlideout } from '../company/TestEmailSlideout'

const DESTINATIONS: AgentDestination[] = ['email', 'internal_chat']

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** The editor shell: clean, direct, high-density layout. */
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

  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [customText, setCustomText] = useState('')
  const [tab, setTab] = useState<'email' | 'chat'>('email')
  const [pending, setPending] = useState<UpdateAgentInput>({})
  const [showMenu, setShowMenu] = useState(false)
  const [showVarModal, setShowVarModal] = useState(false)
  const [showTestModal, setShowTestModal] = useState(false)
  const [copiedVar, setCopiedVar] = useState<string | null>(null)

  const agent = query.data
  useEffect(() => {
    setName(agent?.name ?? '')
    setSubject(agent?.subject ?? (agent as any)?.effectiveSubject ?? (agent as any)?.defaultSubject ?? '')
    setCustomText(agent?.customText ?? (agent as any)?.effectiveText ?? (agent as any)?.defaultText ?? '')
  }, [agent?.name, agent?.subject, agent?.customText, (agent as any)?.effectiveSubject, (agent as any)?.effectiveText, (agent as any)?.defaultSubject, (agent as any)?.defaultText])

  useEffect(() => setPending({}), [agent?.updatedAt])

  const sendersQuery = useEmailConnections(workspaceId)
  const connections = sendersQuery.data ?? []

  const editable = canManage && agent?.status !== 'archived'
  const save = (body: UpdateAgentInput) => {
    setPending((p) => ({ ...p, ...body }))
    void update.mutateAsync(body).catch(() => setPending({}))
  }

  // Real-time debounced auto-save for subject and customText so preview updates live while typing
  useEffect(() => {
    if (!agent || !editable) return
    const initSub = agent.subject ?? (agent as any)?.effectiveSubject ?? (agent as any)?.defaultSubject ?? ''
    const initTxt = agent.customText ?? (agent as any)?.effectiveText ?? (agent as any)?.defaultText ?? ''
    if (subject !== initSub || customText !== initTxt) {
      const timer = setTimeout(() => {
        save({
          subject: subject.trim() || null,
          customText: customText.trim() || null,
        })
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [subject, customText, agent?.subject, agent?.customText, editable])

  if (query.isLoading) return <p className="agents-status">Loading automation…</p>
  if (query.isError || !agent)
    return (
      <div className="agents-editor">
        <div className="agents-bar">
          <button type="button" className="agents-back" onClick={onBack}>
            ← Automations
          </button>
        </div>
        <p className="agents-status">This automation isn’t available.</p>
      </div>
    )

  const destinations = pending.destinations ?? agent.destinations
  const include = pending.include ?? agent.include
  const schedule = pending.schedule ?? agent.schedule ?? { repeat: 'daily' as const, time: '08:00' }
  const templateKey = pending.templateKey ?? agent.templateKey
  const themeKey = pending.themeKey ?? agent.themeKey
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])
  const busy = update.isPending || publish.isPending || pause.isPending || remove.isPending
  const actionError = [update, publish, pause, remove].find((m) => m.isError)?.error

  const isFollowup = agent.family === 'followup'
  const isManual = agent.family === 'manual'
  const isScheduled = agent.family === 'scheduled' || agent.family === 'team'
  const supportsChat = agent.destinations.includes('internal_chat') || agent.family === 'team' || agent.family === 'social'

  const initialSubject = agent.subject ?? (agent as any)?.effectiveSubject ?? (agent as any)?.defaultSubject ?? ''
  const initialCustomText = agent.customText ?? (agent as any)?.effectiveText ?? (agent as any)?.defaultText ?? ''

  const isDirty =
    Object.keys(pending).length > 0 ||
    (name.trim() !== '' && name.trim() !== agent.name) ||
    subject !== initialSubject ||
    customText !== initialCustomText

  const handleExplicitSave = () => {
    const payload: UpdateAgentInput = {
      ...pending,
      name: name.trim() || agent.name,
      subject: subject.trim() || null,
      customText: customText.trim() || null,
    }
    save(payload)
  }

  const senderIsReady = agent.sender.status === 'active'
  const canPublish = canManage && senderIsReady && agent.problems.length === 0

  return (
    <section className="agents-editor" aria-label={agent.name}>
      <div className="agents-bar">
        <button type="button" className="agents-back" onClick={onBack}>
          ← Back to Automations
        </button>
      </div>

      <div className="agents-editor-head">
        <input
          className="agents-name"
          aria-label="Automation name"
          value={name}
          disabled={!editable}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== agent.name && save({ name: name.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {canManage && (
          <div className="agents-actions" style={{ position: 'relative' }}>
            <button
              type="button"
              className="agents-button agents-button-quiet"
              disabled={!isDirty || update.isPending}
              onClick={handleExplicitSave}
            >
              {update.isPending ? 'Saving…' : isDirty ? 'Save' : 'Saved'}
            </button>
            {agent.status === 'active' ? (
              <button type="button" className="agents-button agents-button-quiet" disabled={busy} onClick={() => void pause.mutateAsync().catch(() => undefined)}>
                Pause
              </button>
            ) : agent.status !== 'archived' ? (
              <button
                type="button"
                className="agents-button"
                disabled={busy || !canPublish}
                title={!senderIsReady ? 'Fix or test sender connection in Company → Integrations before publishing' : ''}
                onClick={() => void publish.mutateAsync().catch(() => undefined)}
              >
                {agent.status === 'paused' ? 'Resume' : 'Start'}
              </button>
            ) : null}

            {agent.status !== 'archived' && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="agents-button agents-button-quiet"
                  style={{ padding: '0.25rem 0.6rem', fontSize: '1.1rem', lineHeight: '1' }}
                  title="More options"
                  onClick={() => setShowMenu(!showMenu)}
                >
                  ⋮
                </button>
                {showMenu && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: '4px',
                      background: 'var(--panel, #ffffff)',
                      border: 'var(--line-width, 1px) solid var(--line, #e2e8f0)',
                      borderRadius: 'var(--radius-sm, 4px)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      zIndex: 20,
                      minWidth: '130px',
                      padding: '4px 0',
                    }}
                  >
                    <button
                      type="button"
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--danger, #dc2626)',
                        fontSize: 'var(--text-xs, 12px)',
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        setShowMenu(false)
                        const verb = agent.lastEvent ? 'Archive' : 'Delete'
                        if (window.confirm(`${verb} “${agent.name}”? ${agent.lastEvent ? 'Its history stays in Activity.' : ''}`)) {
                          void remove.mutateAsync().then(onBack).catch(() => undefined)
                        }
                      }}
                    >
                      {agent.lastEvent ? 'Archive automation' : 'Delete automation'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {agent.status === 'active' && editable && (
        <p className="agents-live-note" role="note">Changes to this active automation may affect its next scheduled delivery.</p>
      )}
      {actionError && <p className="agents-status agents-status-bad" role="alert">{errorText(actionError, 'Action failed.')}</p>}
      

      <div className="agents-editor-grid">
        <div className="agents-fields">
        <label className="agents-field" style={{ gridTemplateColumns: '9rem minmax(0, 1fr)' }}>
          <span className="agents-field-name">FROM</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {editable && connections.length > 0 ? (
              <select
                value={agent.sender.id}
                disabled={!editable}
                onChange={(e) => save({ emailConnectionId: e.target.value })}
                style={{ flex: 1, maxWidth: '28rem' }}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} {c.fromAddress ? `(${c.fromAddress})` : ''} {c.status !== 'active' ? ' ⚠️ (needs attention)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                <strong>{agent.sender.label}</strong>
                {agent.sender.fromAddress ? ` (${agent.sender.fromAddress})` : ''}
              </span>
            )}
            <button
              type="button"
              className="agents-button agents-button-quiet"
              style={{ fontSize: 'var(--text-xs)', padding: '4px 10px' }}
              onClick={() => setShowTestModal(true)}
            >
              Test sender
            </button>
          </div>
        </label>

        <AudienceEditor workspaceId={workspaceId} config={agent.recipientConfig} count={agent.recipientCount} editable={editable && !busy} save={recipientConfig => update.mutateAsync({ recipientConfig })} />

        {supportsChat && (
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
        )}

        {/* Family-Specific Trigger & Timing Controls */}
        {isFollowup && (
          <>
            <div className="agents-field">
              <span className="agents-field-name">Trigger</span>
              <span>
                {agent.typeKey === 'welcome_new_customer' ? 'Contact enters a won stage or Customer category'
                  : agent.typeKey === 'checkin_no_reply' ? 'Recorded outreach with no subsequent reply'
                  : agent.typeKey === 'followup_status_change' ? 'Contact pipeline stage changes'
                  : 'A job or service is recorded as completed'}
              </span>
            </div>
            <div className="agents-field">
              <span className="agents-field-name">Timing</span>
              <label><input type="number" min={agent.typeKey === 'checkin_no_reply' ? 1 : 0} max={365} disabled={!editable} aria-label="Trigger delay in days" value={agent.typeKey === 'checkin_no_reply' ? agent.trigger?.noReplyDays ?? 7 : agent.trigger?.delayDays ?? 0} onChange={e => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= (agent.typeKey === 'checkin_no_reply' ? 1 : 0) && value <= 365) save({ trigger: { delayDays: agent.trigger?.delayDays ?? 0, noReplyDays: agent.trigger?.noReplyDays ?? 7, ...(agent.typeKey === 'checkin_no_reply' ? { noReplyDays: value } : { delayDays: value }) } }) }} /> days {agent.typeKey === 'checkin_no_reply' ? 'without a reply' : 'after the event'}</label>
            </div>
          </>
        )}

        {isManual && (
          <div className="agents-field">
            <span className="agents-field-name">Trigger</span>
            <span>Manual broadcast on demand</span>
          </div>
        )}

        {isScheduled && (
          <>
            <label className="agents-field">
              <span className="agents-field-name">Repeat</span>
              <select
                value={schedule.weekdaysOnly ? 'weekdays' : schedule.repeat ?? 'daily'}
                disabled={!editable}
                onChange={(e) => save({ schedule: { repeat: e.target.value === 'weekdays' ? 'daily' : (e.target.value as any), time: schedule.time ?? '08:00', weekdaysOnly: e.target.value === 'weekdays', ...(e.target.value === 'monthly' ? { date: 1 } : e.target.value === 'weekly' ? { weekday: 1 } : {}) } })}
              >
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="agents-field">
              <span className="agents-field-name">Time</span>
              <input
                type="time"
                step={900}
                value={schedule.time ?? '08:00'}
                disabled={!editable}
                onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && save({ schedule: { ...schedule, repeat: schedule.repeat ?? 'daily', time: e.target.value } })}
              />
            </label>
          </>
        )}

        <div className="agents-field">
          <span className="agents-field-name">Next delivery</span>
          <span>
            {agent.status === 'active' && agent.nextEvent ? (
              <button type="button" className="agents-link" onClick={() => onOpenEvent(agent.nextEvent!.id)}>
                {when(agent.nextEvent.scheduledFor, timeZone)}
              </button>
            ) : agent.status === 'active' ? (
              'Event-driven'
            ) : agent.status === 'paused' ? (
              'Paused'
            ) : (
              'After publish'
            )}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
          <div>
            {editable && ((agent as any)?.defaultSubject || (agent as any)?.defaultText) && (
              <button
                type="button"
                className="agents-button agents-button-quiet"
                style={{ fontSize: 'var(--text-xs)', padding: '2px 8px' }}
                onClick={() => {
                  const defSub = (agent as any)?.defaultSubject ?? ''
                  const defTxt = (agent as any)?.defaultText ?? ''
                  setSubject(defSub)
                  setCustomText(defTxt)
                  save({ subject: null, customText: null })
                }}
              >
                ↺ Reset to default wording
              </button>
            )}
          </div>
        </div>
        <label className="agents-field" style={{ gridTemplateColumns: '9rem minmax(0, 1fr)' }}>
          <span className="agents-field-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            Subject
          </span>
          <input
            type="text"
            placeholder="Email subject line..."
            disabled={!editable}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label className="agents-field" style={{ gridTemplateColumns: '9rem minmax(0, 1fr)' }}>
          <span className="agents-field-name">Body Text</span>
          <textarea
            rows={4}
            placeholder="Email message body text..."
            disabled={!editable}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            style={{ width: '100%', fontFamily: 'inherit', fontSize: 'var(--text-sm)', padding: '0.5rem', minHeight: '15rem' }}
          />
        </label>

        {agent.sections.length > 0 && (
          <>
            <h2 className="agents-label">Include Sections</h2>
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
          </>
        )}

        <label className="agents-field">
          <span className="agents-field-name">Style</span>
          <div style={{ display: 'flex', flexDirection: 'row', gap: '0.5rem' }}>
            <select value={templateKey} disabled={!editable} onChange={(e) => save({ templateKey: e.target.value })}>
              {EMAIL_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
            ))}
          </select>
          <select value={themeKey} disabled={!editable || templateKey === 'plain'} onChange={(e) => save({ themeKey: e.target.value })}>
            {EMAIL_THEMES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
          </div>
        </label>
      </div>

      <div className="agents-preview">
        {preview.isLoading && <p className="agents-status">Loading preview…</p>}
        {preview.isError && (
          <p className="agents-status agents-status-bad">
            {errorText(preview.error, 'Couldn’t build the preview.')}
          </p>
        )}
        {preview.data &&
          (supportsChat && tab === 'chat' ? (
            <pre className="agents-chat">{preview.data.chat}</pre>
          ) : (
            <>
              <h2 className="agents-subject">
                <span style={{ color: 'var(--muted)' }}>Subject: </span>
                {subject !== initialSubject ? subject : preview.data.subject}
              </h2>
              {preview.data.html ? (
                <iframe className="agents-frame" title="Email preview" sandbox="" srcDoc={preview.data.html} />
              ) : (
                <pre className="agents-chat">{preview.data.text}</pre>
              )}
            </>
          ))}
      </div>
      </div>

      {showVarModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
          onClick={() => setShowVarModal(false)}
        >
          <div
            style={{
              background: 'var(--panel, #ffffff)',
              border: 'var(--line-width, 1px) solid var(--line, #e2e8f0)',
              borderRadius: 'var(--radius, 8px)',
              padding: '1.25rem',
              maxWidth: '420px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--text-base, 16px)', fontWeight: 600, color: 'var(--ink)' }}>
                Variables
              </h3>
              <button
                type="button"
                className="agents-button agents-button-quiet"
                style={{ padding: '2px 8px', fontSize: '1rem', lineHeight: 1 }}
                onClick={() => setShowVarModal(false)}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'grid', gap: '0.25rem', maxHeight: '320px', overflowY: 'auto' }}>
              {MERGE_FIELDS.map((field) => {
                const tag = `{{${field}}}`
                const isCopied = copiedVar === tag
                return (
                  <div
                    key={field}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm, 4px)',
                      cursor: 'pointer',
                      color: 'var(--ink)',
                    }}
                    onClick={() => {
                      void navigator.clipboard?.writeText(tag)
                      setCopiedVar(tag)
                      setTimeout(() => setCopiedVar(null), 1800)
                    }}
                  >
                    <code style={{ fontSize: 'var(--text-xs, 12px)', fontFamily: 'monospace', color: 'var(--ink)' }}>
                      {tag}
                    </code>
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      {isCopied ? '✓ Copied' : 'Copy'}
                    </span>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button
                type="button"
                className="agents-button"
                style={{ fontSize: 'var(--text-xs, 12px)' }}
                onClick={() => setShowVarModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showTestModal && (
        <TestEmailSlideout
          workspaceId={workspaceId}
          senderLabel={agent.sender.label}
          senderFromAddress={agent.sender.fromAddress ?? undefined}
          connectionId={agent.sender.id}
          onClose={() => setShowTestModal(false)}
        />
      )}
    </section>
  )
}

