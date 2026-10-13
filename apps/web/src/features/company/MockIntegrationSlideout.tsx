import { useState, type FormEvent } from 'react'
import { FormSlideout } from '../work/FormSlideout'
import { IntegrationBrandIcon } from '../../components/icons'
import { Badge } from '../../components/ui/Badge'
import type { IntegrationDef } from './integrationsCatalog'

export function MockIntegrationSlideout({
  integration,
  currentConfig,
  isConnected,
  onSave,
  onDisconnect,
  onClose,
}: {
  integration: IntegrationDef
  currentConfig?: Record<string, string>
  isConnected: boolean
  onSave: (id: string, values: Record<string, string>, detailsSummary: string) => void
  onDisconnect: (id: string) => void
  onClose: () => void
}) {
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const field of integration.configFields) {
      initial[field.key] = currentConfig?.[field.key] ?? field.defaultValue ?? ''
    }
    return initial
  })
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setTimeout(() => {
      // Create a nice human-readable summary of the connection
      let summary = 'Connected'
      const firstVal = Object.values(formData).find((v) => v.trim())
      if (firstVal) {
        summary = firstVal.length > 28 ? `${firstVal.slice(0, 26)}…` : firstVal
      }
      onSave(integration.id, formData, summary)
      setSubmitting(false)
      onClose()
    }, 250)
  }

  const handleDisconnect = () => {
    if (window.confirm(`Disconnect ${integration.name}? Any active automation using this connector will stop syncing.`)) {
      onDisconnect(integration.id)
      onClose()
    }
  }

  return (
    <FormSlideout title={`Configure ${integration.name}`} onClose={onClose}>
      <form className="company-form" onSubmit={handleSubmit} style={{ padding: 'var(--space-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 'var(--space-md)' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-md)',
              background: 'color-mix(in srgb, var(--ink) 5%, var(--panel))',
              border: '1px solid var(--line)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <IntegrationBrandIcon service={integration.service} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>{integration.name}</h3>
              <Badge variant={isConnected ? 'connected' : 'default'} showDot={isConnected}>
                {isConnected ? 'Connected' : 'Available'}
              </Badge>
            </div>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
              {integration.categoryLabel} Integration
            </span>
          </div>
        </div>

        <p className="company-note" style={{ margin: '0 0 var(--space-md)', fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
          {integration.description}
        </p>

        {integration.id === 'rest-api' ? (
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 12px',
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--mono)',
              }}
            >
              <span>POST /api/workspaces/tasks</span>
              <button
                type="button"
                className="ui-btn-action"
                style={{ height: '24px', padding: '0 8px', fontSize: '11px' }}
                onClick={() => {
                  void navigator.clipboard?.writeText(`curl -X POST "${window.location.origin}/api/workspaces/tasks" -H "Content-Type: application/json" -d '{"title":"New Task"}'`)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1800)
                }}
              >
                {copied ? '✓ Copied' : 'Copy cURL'}
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                padding: '12px',
                background: 'color-mix(in srgb, var(--ink) 4%, var(--panel))',
                border: '1px solid var(--line)',
                borderTop: 0,
                borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
                fontSize: '11px',
                fontFamily: 'var(--mono)',
                overflowX: 'auto',
              }}
            >
              {`curl -X POST "${typeof window !== 'undefined' ? window.location.origin : 'https://8080.app'}/api/workspaces/tasks" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer <WORKSPACE_API_KEY>" \\\n  -d '{"title":"Automated Review","day":"2026-10-15"}'`}
            </pre>
          </div>
        ) : null}

        <div className="record-form-fields" style={{ gridTemplateColumns: '1fr', gap: 'var(--space-md)' }}>
          {integration.configFields.map((field) => (
            <label key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>{field.label}</span>
              {field.type === 'select' ? (
                <select
                  value={formData[field.key] ?? ''}
                  onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                >
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  placeholder={field.placeholder}
                  value={formData[field.key] ?? ''}
                  onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                />
              )}
            </label>
          ))}
        </div>

        <p className="company-note" style={{ marginTop: 'var(--space-md)', fontSize: 'var(--text-xs)' }}>
          ℹ️ {integration.helpNote}
        </p>

        <footer style={{ marginTop: 'var(--space-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {isConnected ? (
            <button
              type="button"
              className="ui-btn-action"
              style={{ color: 'var(--danger, #dc2626)', border: '1px solid var(--line)' }}
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
          ) : (
            <button type="button" className="company-go" onClick={onClose}>
              Cancel
            </button>
          )}

          <button type="submit" className="record-primary" disabled={submitting}>
            {submitting ? 'Connecting…' : isConnected ? 'Save Configuration' : `Connect ${integration.name}`}
          </button>
        </footer>
      </form>
    </FormSlideout>
  )
}
