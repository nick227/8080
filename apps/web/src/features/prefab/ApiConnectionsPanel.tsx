import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEmailConnections, type EmailConnection } from '@project/sdk'
import { useCurrentWorkspace } from '../../app/workspace'
import { PlugIcon, IntegrationBrandIcon } from '../../components/icons'
import { Badge } from '../../components/ui/Badge'
import './api-connections.css'

export type ApiDomain = 'tasks' | 'contacts' | 'inventory' | 'budget' | 'team' | 'documents' | 'automations'

type DomainMeta = {
  label: string
  endpoint: string
  sample: string
}

const DOMAIN_CONFIG: Record<ApiDomain, DomainMeta> = {
  tasks: {
    label: 'Tasks',
    endpoint: 'tasks',
    sample: JSON.stringify(
      [
        {
          title: 'Quarterly review',
          day: '2026-10-15',
          time: '09:00 AM',
          status: 'open',
        },
      ],
      null,
      2
    ),
  },
  contacts: {
    label: 'Contacts',
    endpoint: 'records',
    sample: JSON.stringify(
      [
        {
          displayName: 'Jordan Miller',
          primaryEmail: 'jordan@example.com',
          primaryPhone: '512-555-0144',
          organization: 'Acme Corp',
        },
      ],
      null,
      2
    ),
  },
  inventory: {
    label: 'Inventory',
    endpoint: 'records',
    sample: JSON.stringify(
      [
        {
          name: 'Pro Wireless Mic',
          sku: 'MIC-PRO-01',
          unitPriceMinor: 14900,
          quantityOnHand: 18,
        },
      ],
      null,
      2
    ),
  },
  budget: {
    label: 'Budget',
    endpoint: 'budget/items',
    sample: JSON.stringify(
      [
        {
          title: 'Cloud Infrastructure',
          amountMinor: 85000,
          direction: 'expense',
          category: 'software',
          scheduledDate: '2026-10-20',
        },
      ],
      null,
      2
    ),
  },
  team: {
    label: 'Team Roles',
    endpoint: 'team',
    sample: JSON.stringify(
      [
        {
          roleTitle: 'Technical Project Lead',
          department: 'Engineering',
          hoursPerWeek: 40,
        },
      ],
      null,
      2
    ),
  },
  documents: {
    label: 'Documents',
    endpoint: 'documents',
    sample: JSON.stringify(
      [
        {
          title: 'Standard Client Agreement',
          summary: 'Master contract framework for client engagements',
        },
      ],
      null,
      2
    ),
  },
  automations: {
    label: 'Automations',
    endpoint: 'agents',
    sample: JSON.stringify(
      [
        {
          typeKey: 'team-daily-brief',
          name: 'Daily Morning Team Brief',
        },
      ],
      null,
      2
    ),
  },
}

const STRATEGY_LABEL: Record<EmailConnection['strategy'], string> = {
  platform: '8080 Platform',
  smtp: 'Custom SMTP',
  google: 'Google Workspace / Gmail',
  microsoft: 'Microsoft 365',
  resend_domain: 'Custom Domain',
}

export function ApiConnectionsPanel({
  workspaceId,
  domain,
  onClose,
}: {
  workspaceId?: string
  domain: ApiDomain
  onClose?: () => void
}) {
  const navigate = useNavigate()
  const { workspace } = useCurrentWorkspace()
  const effectiveWsId = workspaceId || workspace?.id || ''
  const emailConn = useEmailConnections(effectiveWsId || undefined)

  const [copied, setCopied] = useState(false)
  const [sheetsConnected, setSheetsConnected] = useState(false)
  const [airtableConnected, setAirtableConnected] = useState(false)
  const [wooConnected, setWooConnected] = useState(false)
  const [sheetsId, setSheetsId] = useState('')
  const [airtableBase, setAirtableBase] = useState('')

  const meta = DOMAIN_CONFIG[domain] ?? DOMAIN_CONFIG.tasks
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.8080.internal'
  const apiPath = `/api/workspaces/${effectiveWsId || ':workspaceId'}/${meta.endpoint}${
    domain === 'contacts' || domain === 'inventory' ? `?kind=${domain}` : ''
  }`

  const curlCommand = `curl -X POST "${origin}${apiPath}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <WORKSPACE_API_KEY>" \\
  -d '${meta.sample.replace(/\n/g, '\n  ')}'`

  const handleCopyCurl = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(curlCommand)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenWorkspaceIntegrations = () => {
    if (effectiveWsId) {
      navigate(`/c/${effectiveWsId}?settings=integrations`)
      onClose?.()
    }
  }

  const senders = emailConn.data ?? []

  return (
    <div className="api-connections-panel" role="region" aria-label="API connections and integrations">
      {/* Workspace Integrations Link Banner */}
      <div className="api-conn-banner">
        <div className="api-conn-banner-left">
          <div className="api-conn-banner-icon" aria-hidden="true">
            <PlugIcon />
          </div>
          <div className="api-conn-banner-text">
            <h3>Workspace Integrations</h3>
            <p>
              Connected services, OAuth credentials, and email identities for{' '}
              <strong>{workspace?.name || 'this workspace'}</strong>.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="api-conn-manage-btn"
          onClick={handleOpenWorkspaceIntegrations}
          aria-label="Manage Integrations in Settings"
        >
          Manage in Workspace Settings →
        </button>
      </div>

      {/* Configured Workspace Connections */}
      <div className="api-conn-section">
        <div className="api-conn-section-head">
          <h4 className="api-conn-section-title">
            <IntegrationBrandIcon service="google" />
            Configured Workspace Connections
          </h4>
          <span className="api-conn-section-desc">Active auth & sender integrations</span>
        </div>

        <div className="api-conn-active-list">
          {emailConn.isLoading ? (
            <div className="api-conn-active-item">
              <span className="api-conn-active-item-sub">Loading active connections…</span>
            </div>
          ) : senders.length > 0 ? (
            senders.map((s) => (
              <div key={s.id} className="api-conn-active-item">
                <div className="api-conn-active-item-left">
                  <span className="api-conn-active-item-label">{s.label}</span>
                  <span className="api-conn-active-item-sub">({STRATEGY_LABEL[s.strategy] ?? s.strategy})</span>
                </div>
                <Badge
                  variant={s.status === 'active' ? 'connected' : s.status === 'needs_attention' ? 'warning' : 'disconnected'}
                  showDot
                >
                  {s.status === 'active' ? 'Connected' : s.status === 'needs_attention' ? 'Attention' : 'Disabled'}
                </Badge>
              </div>
            ))
          ) : (
            <div className="api-conn-active-item">
              <div className="api-conn-active-item-left">
                <span className="api-conn-active-item-label">Default 8080 Platform Integration</span>
                <span className="api-conn-active-item-sub">(System internal connector)</span>
              </div>
              <Badge variant="connected" showDot>
                Active
              </Badge>
            </div>
          )}
        </div>
      </div>

      {/* Direct Inbound REST API Endpoint */}
      <div className="api-conn-section">
        <div className="api-conn-section-head">
          <h4 className="api-conn-section-title">Inbound REST API Endpoint</h4>
          <span className="api-conn-section-desc">Push {meta.label.toLowerCase()} directly via JSON</span>
        </div>
        <p className="api-conn-section-desc">
          Automate ingestion using HTTP POST requests from your pipelines, webhooks, or third-party tools.
        </p>

        <div className="api-conn-code-wrapper">
          <div className="api-conn-code-bar">
            <span>POST {apiPath}</span>
            <button
              type="button"
              className="api-conn-copy-btn"
              data-copied={copied || undefined}
              onClick={handleCopyCurl}
            >
              {copied ? '✓ Copied' : 'Copy cURL'}
            </button>
          </div>
          <pre className="api-conn-code">{curlCommand}</pre>
        </div>
      </div>

      {/* Third-Party Connectors */}
      <div className="api-conn-section">
        <div className="api-conn-section-head">
          <h4 className="api-conn-section-title">Third-Party Data Connectors</h4>
          <span className="api-conn-section-desc">Sync {meta.label.toLowerCase()} from external apps</span>
        </div>

        <div className="api-conn-grid">
          {/* Google Sheets */}
          <div className="api-conn-card">
            <div className="api-conn-card-head">
              <span className="api-conn-card-title">Google Sheets Sync</span>
              <Badge variant={sheetsConnected ? 'connected' : 'default'} showDot={sheetsConnected}>
                {sheetsConnected ? 'Synced' : 'Ready'}
              </Badge>
            </div>
            <p className="api-conn-card-desc">Sync rows periodically from a Google Sheet tab into {meta.label}.</p>
            <div className="api-conn-card-inputs">
              <div className="api-conn-input-group">
                <label>
                  <span>Spreadsheet ID or URL</span>
                  <input
                    type="text"
                    placeholder="e.g. 1BxiMVs0XR…"
                    value={sheetsId}
                    onChange={(e) => setSheetsId(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <button
              type="button"
              className="api-conn-card-btn"
              data-connected={sheetsConnected || undefined}
              onClick={() => setSheetsConnected(!sheetsConnected)}
            >
              {sheetsConnected ? '✓ Connection Active' : 'Connect Spreadsheet'}
            </button>
          </div>

          {/* Airtable */}
          <div className="api-conn-card">
            <div className="api-conn-card-head">
              <span className="api-conn-card-title">Airtable Connector</span>
              <Badge variant={airtableConnected ? 'connected' : 'default'} showDot={airtableConnected}>
                {airtableConnected ? 'Connected' : 'Ready'}
              </Badge>
            </div>
            <p className="api-conn-card-desc">Import and map records from an Airtable Base table or view.</p>
            <div className="api-conn-card-inputs">
              <div className="api-conn-input-group">
                <label>
                  <span>Base ID / Table Name</span>
                  <input
                    type="text"
                    placeholder="app… / Table 1"
                    value={airtableBase}
                    onChange={(e) => setAirtableBase(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <button
              type="button"
              className="api-conn-card-btn"
              data-connected={airtableConnected || undefined}
              onClick={() => setAirtableConnected(!airtableConnected)}
            >
              {airtableConnected ? '✓ Base Linked' : 'Connect Airtable'}
            </button>
          </div>

          {/* WooCommerce for Inventory */}
          {domain === 'inventory' && (
            <div className="api-conn-card">
              <div className="api-conn-card-head">
                <span className="api-conn-card-title">WooCommerce Store</span>
                <Badge variant={wooConnected ? 'connected' : 'default'} showDot={wooConnected}>
                  {wooConnected ? 'Live' : 'Ready'}
                </Badge>
              </div>
              <p className="api-conn-card-desc">Sync product catalog and stock levels directly with WooCommerce.</p>
              <button
                type="button"
                className="api-conn-card-btn"
                data-connected={wooConnected || undefined}
                onClick={() => setWooConnected(!wooConnected)}
              >
                {wooConnected ? '✓ Store Linked' : 'Connect Store'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
