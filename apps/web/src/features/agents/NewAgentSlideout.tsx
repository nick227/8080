import { useState } from 'react'
import { useAgentTypes, useCreateAgent } from '@project/sdk'
import { FormSlideout } from '../work/FormSlideout'
import { FAMILY_LABEL, DEFAULT_SCHEDULE_HINT } from './AgentCatalog'
import './agents.css'
import '../documents/DocumentsList.css'

export function NewAgentSlideout({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string
  onClose: () => void
  onCreated: (agentId: string) => void
}) {
  const types = useAgentTypes(workspaceId)
  const create = useCreateAgent(workspaceId)
  const [channelFilter, setChannelFilter] = useState<'all' | 'email' | 'team' | 'social'>('all')

  const rows = types.data ?? []
  const channels = [
    {
      id: 'email',
      name: 'Email Automations',
      rows: rows.filter((type) => type.family !== 'social' && type.family !== 'team'),
    },
    {
      id: 'team',
      name: 'Team & Collaboration',
      rows: rows.filter((type) => type.family === 'team'),
    },
    {
      id: 'social',
      name: 'Social & Public',
      rows: rows.filter((type) => type.family === 'social'),
    },
  ]

  const visibleChannels =
    channelFilter === 'all'
      ? channels.filter((c) => c.rows.length > 0)
      : channels.filter((c) => c.id === channelFilter && c.rows.length > 0)

  const handleCreate = (typeKey: string) => {
    if (create.isPending) return
    create.mutate(
      { typeKey },
      {
        onSuccess: (agent) => {
          onCreated(agent.id)
        },
      },
    )
  }

  return (
    <FormSlideout title="New automation" onClose={onClose} width="780px">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
          padding: 'var(--space-md) var(--space-lg)',
          flex: 1,
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
            Select an automation template to deploy into your workspace.
          </p>
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['all', 'email', 'team', 'social'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className="cal-btn"
                style={{
                  fontWeight: channelFilter === tab ? 'var(--weight-bold)' : 'normal',
                  opacity: channelFilter === tab ? 1 : 0.6,
                }}
                onClick={() => setChannelFilter(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {types.isLoading && <p className="agents-status">Loading automation templates…</p>}
        {types.isError && (
          <p className="agents-status agents-status-bad" role="alert">
            Couldn’t load automation templates.
          </p>
        )}

        <div className="agents-tables-stack" style={{ gap: 'var(--space-lg)' }}>
          {visibleChannels.map((channel) => (
            <section key={channel.name} aria-label={`${channel.name} templates`}>
              <h3 className="agents-label" style={{ margin: 'var(--space-xs) 0 var(--space-xs) 4px' }}>
                {channel.name}
              </h3>
              <div className="docs-table-wrap" tabIndex={0} role="region">
                <table className="docs-table agents-catalog-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="docs-sort">Template</span>
                      </th>
                      <th scope="col" className="agents-catalog-family">
                        <span className="docs-sort">Family</span>
                      </th>
                      <th scope="col" className="agents-catalog-schedule">
                        <span className="docs-sort">Trigger / Schedule</span>
                      </th>
                      <th scope="col" className="docs-col-action">
                        <span className="docs-sort">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {channel.rows.map((t) => {
                      const familyName = FAMILY_LABEL[t.family] ?? t.family
                      const scheduleHint =
                        DEFAULT_SCHEDULE_HINT[t.key] ??
                        (t.family === 'manual' ? 'Manual / On-demand' : 'Scheduled')
                      return (
                        <tr
                          key={t.key}
                          style={{ cursor: 'pointer' }}
                          onClick={() => handleCreate(t.key)}
                        >
                          <td className="agents-cell-title" title={t.name}>
                            <b>{t.name}</b>
                          </td>
                          <td>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-pill)',
                                background: 'color-mix(in srgb, var(--ink) 6%, transparent)',
                                fontSize: '11px',
                                fontWeight: 'var(--weight-medium)',
                              }}
                            >
                              {familyName}
                            </span>
                          </td>
                          <td title={scheduleHint} style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                            {scheduleHint}
                          </td>
                          <td className="docs-col-action">
                            <button
                              type="button"
                              className="docs-preview-btn"
                              disabled={create.isPending}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleCreate(t.key)
                              }}
                            >
                              {create.isPending ? '…' : '+ Create'}
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
          <p className="agents-status agents-status-bad" role="alert">
            {create.error instanceof Error ? create.error.message : 'Couldn’t add the automation.'}
          </p>
        )}
      </div>
    </FormSlideout>
  )
}
