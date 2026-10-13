import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getApiClient,
  useCreateEmailConnection,
  useDeleteEmailConnection,
  useEmailConnections,
  useUpdateEmailConnection,
  type CreateEmailConnectionInput,
  type EmailConnection,
} from '@project/sdk'
import { Badge } from '../../components/ui/Badge'
import { IntegrationBrandIcon } from '../../components/icons'
import { FormSlideout } from '../work/FormSlideout'
import { TestEmailSlideout } from './TestEmailSlideout'
import { INTEGRATIONS_CATALOG, type IntegrationDef } from './integrationsCatalog'
import { MockIntegrationSlideout } from './MockIntegrationSlideout'

const VIA: Record<EmailConnection['strategy'], string> = {
  platform: '8080 Platform Mail',
  smtp: 'Custom SMTP Server',
  google: 'Google Workspace / Gmail',
  microsoft: 'Microsoft 365',
  resend_domain: 'Domain Mail',
}

const GMAIL_ERRORS: Record<string, string> = {
  canceled: 'Gmail wasn’t connected: the Google sign-in was canceled.',
  access_denied: 'Gmail wasn’t connected: access was not granted.',
  invalid_state: 'Gmail wasn’t connected: the request expired. Try again.',
  unauthorized: 'Gmail wasn’t connected: only the admin who started it can finish it, in the same browser.',
}

interface MockStateRecord {
  connected: boolean
  values: Record<string, string>
  summary: string
  updatedAt: string
}

export function IntegrationsSection({
  workspaceId,
  canEdit,
  variant = 'card',
}: {
  workspaceId: string
  canEdit: boolean
  variant?: 'card' | 'settings'
}) {
  const list = useEmailConnections(workspaceId)
  const deleteConnection = useDeleteEmailConnection(workspaceId)
  const createConnection = useCreateEmailConnection(workspaceId)
  const [params, setParams] = useSearchParams()

  const [activeTab, setActiveTab] = useState<'all' | 'enabled' | 'available'>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [testing, setTesting] = useState<EmailConnection | null>(null)
  const [addingWay, setAddingWay] = useState<'choose' | 'smtp' | null>(null)
  const [configuringMock, setConfiguringMock] = useState<IntegrationDef | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const storageKey = `8080.mock_integrations.${workspaceId}`

  // Mock integration storage per workspace
  const [mockState, setMockState] = useState<Record<string, MockStateRecord>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) return JSON.parse(raw)
    } catch {}
    return {}
  })

  // Handle Gmail OAuth redirect status
  useEffect(() => {
    const ok = params.get('gmailSuccess')
    const error = params.get('gmailError')
    if (!ok && !error) return
    setNotice(
      ok
        ? { ok: true, text: 'Google Workspace connected. Automations can now deliver emails from your address.' }
        : { ok: false, text: GMAIL_ERRORS[error!] ?? 'Google wasn’t connected. Try again, or use an SMTP relay.' }
    )
    const next = new URLSearchParams(params)
    next.delete('gmailSuccess')
    next.delete('gmailError')
    setParams(next, { replace: true })
  }, [params, setParams])

  const senders = list.data ?? []

  // Combine real senders with mock integrations into unified items
  const items = useMemo(() => {
    return INTEGRATIONS_CATALOG.map((def) => {
      let isEnabled = false
      let isDefault = false
      let details = 'Not configured'
      let matchedSender: EmailConnection | undefined

      if (def.isNativeEmail && def.emailStrategy) {
        matchedSender = senders.find((s) => s.strategy === def.emailStrategy)
        if (matchedSender) {
          isEnabled = matchedSender.status === 'active'
          isDefault = !!matchedSender.isDefault
          details = matchedSender.fromAddress ?? `Connected (${VIA[matchedSender.strategy]})`
        } else if (def.id === '8080-platform') {
          const mock = mockState[def.id]
          const isExplicitlyOff = mock && mock.connected === false
          isEnabled = !isExplicitlyOff
          isDefault = true
          details = mock?.summary || 'system@8080.app (Built-in Relay)'
        }
      } else {
        const mock = mockState[def.id]
        if (mock?.connected) {
          isEnabled = true
          details = mock.summary || 'Connected & active'
        }
      }

      return {
        def,
        isEnabled,
        isDefault,
        details,
        matchedSender,
        mockRecord: mockState[def.id],
      }
    })
  }, [senders, mockState])

  // Count tallies
  const enabledCount = items.filter((it) => it.isEnabled).length
  const availableCount = items.filter((it) => !it.isEnabled).length
  const totalCount = items.length

  // Filter items according to tab, category, and search query
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (activeTab === 'enabled' && !it.isEnabled) return false
      if (activeTab === 'available' && it.isEnabled) return false
      if (selectedCategory !== 'all' && it.def.category !== selectedCategory) return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesName = it.def.name.toLowerCase().includes(q)
        const matchesDesc = it.def.description.toLowerCase().includes(q)
        const matchesCat = it.def.categoryLabel.toLowerCase().includes(q)
        const matchesService = it.def.service.toLowerCase().includes(q)
        const matchesDetails = it.details.toLowerCase().includes(q)
        if (!matchesName && !matchesDesc && !matchesCat && !matchesService && !matchesDetails) return false
      }
      return true
    })
  }, [items, activeTab, selectedCategory, searchQuery])

  const handleSaveMock = (id: string, values: Record<string, string>, summary: string) => {
    const next = {
      ...mockState,
      [id]: { connected: true, values, summary, updatedAt: new Date().toISOString() },
    }
    setMockState(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {}
    setNotice({ ok: true, text: `Successfully connected ${id}.` })
  }

  const handleDisconnectMock = (id: string) => {
    const next = {
      ...mockState,
      [id]: { connected: false, values: {}, summary: '', updatedAt: new Date().toISOString() },
    }
    setMockState(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {}
    setNotice({ ok: true, text: `Disconnected integration.` })
  }

  const handleRemoveSender = async (conn: EmailConnection) => {
    if (!window.confirm(`Remove ${conn.label}? Automations using it switch to the default sender.`)) return
    setNotice(null)
    try {
      await deleteConnection.mutateAsync(conn.id)
      setNotice({ ok: true, text: `Removed ${conn.label}.` })
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Couldn’t remove sender.' })
    }
  }

  const handleConnectIntegration = async (def: IntegrationDef) => {
    setNotice(null)
    if (def.id === 'google-workspace') {
      setAddingWay('choose')
    } else if (def.id === 'custom-smtp') {
      setAddingWay('smtp')
    } else if (def.id === '8080-platform') {
      handleSaveMock(def.id, { from: 'system@8080.app' }, 'system@8080.app (Built-in Relay)')
      setNotice({ ok: true, text: '8080 Platform Mail enabled as default system relay.' })
    } else {
      setConfiguringMock(def)
    }
  }

  // Common toolbar component
  const renderToolbar = () => (
    <div className="cp-integrations-toolbar">
      <div className="cp-integrations-status-tabs" role="tablist" aria-label="Filter integrations by status">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'all'}
          className={`cp-integrations-tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All <span className="count-badge">{totalCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'enabled'}
          className={`cp-integrations-tab ${activeTab === 'enabled' ? 'active' : ''}`}
          onClick={() => setActiveTab('enabled')}
        >
          <span style={{ color: 'var(--success, #10b981)', fontSize: '10px' }}>●</span> Enabled{' '}
          <span className="count-badge">{enabledCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'available'}
          className={`cp-integrations-tab ${activeTab === 'available' ? 'active' : ''}`}
          onClick={() => setActiveTab('available')}
        >
          <span style={{ opacity: 0.6, fontSize: '10px' }}>○</span> Available{' '}
          <span className="count-badge">{availableCount}</span>
        </button>
      </div>

      <div className="cp-integrations-filters-right">
        <select
          className="cp-integrations-select"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="all">All Categories ({totalCount})</option>
          <option value="social">Social & Messaging</option>
          <option value="communication">Communication</option>
          <option value="productivity">Productivity</option>
          <option value="crm">CRM & Sales</option>
          <option value="commerce">Commerce & Finance</option>
          <option value="developer">Media & Developer</option>
        </select>

        <input
          type="search"
          className="cp-integrations-search"
          placeholder="Search integrations…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search integrations"
        />
      </div>
    </div>
  )

  // Common table rendering
  const renderTable = () => (
    <div className="integrations-table-container">
      <table className="integrations-table">
        <thead>
          <tr>
            <th scope="col" style={{ width: '28%' }}>Integration</th>
            <th scope="col" style={{ width: '18%' }}>Category</th>
            <th scope="col" style={{ width: '16%' }}>Status</th>
            <th scope="col" style={{ width: '24%' }}>Details / Channel</th>
            <th scope="col" style={{ width: '14%', textAlign: 'right' }} aria-label="Actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredItems.map((item) => (
            <IntegrationItemRow
              key={item.def.id}
              workspaceId={workspaceId}
              item={item}
              canEdit={canEdit}
              onConnect={() => void handleConnectIntegration(item.def)}
              onConfigure={() => setConfiguringMock(item.def)}
              onDisconnectMock={() => handleDisconnectMock(item.def.id)}
              onTestEmail={(conn) => setTesting(conn)}
              onRemoveSender={(conn) => void handleRemoveSender(conn)}
              onError={(text) => setNotice({ ok: false, text })}
            />
          ))}
        </tbody>
      </table>
    </div>
  )

  if (variant === 'settings') {
    return (
      <section className="people-section cp-settings-integrations" aria-labelledby="company-integrations-title">
        <div className="cp-settings-section-head">
          <div>
            <h3 id="company-integrations-title">
              Integrations Catalog <span className="people-count">{totalCount}</span>
            </h3>
            <span className="people-muted">
              {enabledCount} enabled · {availableCount} available across social, messaging, communication, CRM, and tools.
            </span>
          </div>
          {canEdit && (
            <button type="button" className="people-btn people-btn-primary" onClick={() => setAddingWay('choose')}>
              + Add email sender
            </button>
          )}
        </div>

        {notice && (
          <p
            className="people-muted"
            style={{ color: notice.ok ? 'var(--signal)' : 'var(--danger, #c0392b)', marginBottom: '12px' }}
            role={notice.ok ? 'status' : 'alert'}
          >
            {notice.text}
          </p>
        )}

        {renderToolbar()}

        {list.isLoading ? (
          <p className="people-muted" role="status">Loading integrations…</p>
        ) : filteredItems.length === 0 ? (
          <div className="cp-integrations-empty">
            <p>No integrations match the current filter.</p>
            <button
              type="button"
              className="cp-action"
              onClick={() => {
                setActiveTab('all')
                setSelectedCategory('all')
                setSearchQuery('')
              }}
            >
              Reset filters
            </button>
          </div>
        ) : (
          renderTable()
        )}

        {testing && (
          <TestEmailSlideout
            workspaceId={workspaceId}
            senderLabel={testing.label}
            senderFromAddress={testing.fromAddress ?? undefined}
            connectionId={testing.id}
            onClose={() => setTesting(null)}
          />
        )}

        {configuringMock && (
          <MockIntegrationSlideout
            integration={configuringMock}
            currentConfig={mockState[configuringMock.id]?.values}
            isConnected={!!mockState[configuringMock.id]?.connected}
            onSave={handleSaveMock}
            onDisconnect={handleDisconnectMock}
            onClose={() => setConfiguringMock(null)}
          />
        )}

        {addingWay && canEdit && (
          <AddSender
            workspaceId={workspaceId}
            initialWay={addingWay}
            onClose={() => setAddingWay(null)}
          />
        )}
      </section>
    )
  }

  // Workspace Home View (variant === 'card')
  return (
    <section className="cp-team-section cp-integrations-section" aria-labelledby="company-integrations-title">
      <header className="cp-section-header">
        <div>
          <h2 id="company-integrations-title" className="cp-section-title">Integrations</h2>
          <span className="cp-section-sub">
            {enabledCount} enabled · {availableCount} available · Social & Messaging, Productivity, CRM, Commerce & Developer tools
          </span>
        </div>
        {canEdit && (
          <button type="button" className="cp-action" onClick={() => setAddingWay('choose')}>
            + Connect sender
          </button>
        )}
      </header>

      {notice && (
        <p className="cp-status" role={notice.ok ? 'status' : 'alert'} data-ok={notice.ok || undefined}>
          {notice.text}
        </p>
      )}

      {renderToolbar()}

      {list.isLoading ? (
        <p className="cp-status" role="status">Loading integrations…</p>
      ) : filteredItems.length === 0 ? (
        <div className="cp-integrations-empty">
          <p>No integrations match your selected filter.</p>
          <button
            type="button"
            className="cp-action"
            onClick={() => {
              setActiveTab('all')
              setSelectedCategory('all')
              setSearchQuery('')
            }}
          >
            Show all integrations
          </button>
        </div>
      ) : (
        renderTable()
      )}

      {testing && (
        <TestEmailSlideout
          workspaceId={workspaceId}
          senderLabel={testing.label}
          senderFromAddress={testing.fromAddress ?? undefined}
          connectionId={testing.id}
          onClose={() => setTesting(null)}
        />
      )}

      {configuringMock && (
        <MockIntegrationSlideout
          integration={configuringMock}
          currentConfig={mockState[configuringMock.id]?.values}
          isConnected={!!mockState[configuringMock.id]?.connected}
          onSave={handleSaveMock}
          onDisconnect={handleDisconnectMock}
          onClose={() => setConfiguringMock(null)}
        />
      )}

      {addingWay && canEdit && (
        <AddSender
          workspaceId={workspaceId}
          initialWay={addingWay}
          onClose={() => setAddingWay(null)}
        />
      )}
    </section>
  )
}

function IntegrationItemRow({
  workspaceId,
  item,
  canEdit,
  onConnect,
  onConfigure,
  onDisconnectMock,
  onTestEmail,
  onRemoveSender,
  onError,
}: {
  workspaceId: string
  item: {
    def: IntegrationDef
    isEnabled: boolean
    isDefault: boolean
    details: string
    matchedSender?: EmailConnection
    mockRecord?: MockStateRecord
  }
  canEdit: boolean
  onConnect: () => void
  onConfigure: () => void
  onDisconnectMock: () => void
  onTestEmail: (conn: EmailConnection) => void
  onRemoveSender: (conn: EmailConnection) => void
  onError: (text: string) => void
}) {
  const update = useUpdateEmailConnection(workspaceId, item.matchedSender?.id ?? '')

  const makeDefault = async () => {
    if (!item.matchedSender) return
    try {
      await update.mutateAsync({ makeDefault: true })
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Couldn’t make it default.')
    }
  }

  return (
    <tr>
      <td>
        <div className="cp-integration-name-cell" title={item.def.description}>
          <div className="cp-integration-icon">
            <IntegrationBrandIcon service={item.def.service} />
          </div>
          <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 'var(--text-sm)' }}>
            {item.def.name}
          </span>
        </div>
      </td>
      <td>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {item.def.categoryLabel}
        </span>
      </td>
      <td>
        <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {item.isEnabled ? (
            <>
              <Badge variant="connected" showDot>
                Enabled
              </Badge>
              {item.isDefault && <Badge variant="default">Default</Badge>}
            </>
          ) : (
            <Badge variant="disconnected">Available</Badge>
          )}
        </span>
      </td>
      <td
        style={{
          fontFamily: 'var(--mono)',
          fontSize: '0.8rem',
          color: item.isEnabled ? 'var(--ink)' : 'var(--muted)',
        }}
      >
        {item.isEnabled ? (
          item.details
        ) : (
          <span style={{ color: 'var(--muted)', fontStyle: 'italic', opacity: 0.7 }}>Not connected</span>
        )}
      </td>
      <td>
        {canEdit && (
          <div className="actions-cell">
            {item.isEnabled ? (
              <>
                {item.matchedSender ? (
                  <>
                    {!item.isDefault && item.matchedSender.status === 'active' && (
                      <button
                        type="button"
                        className="ui-btn-action"
                        disabled={update.isPending}
                        onClick={() => void makeDefault()}
                      >
                        {update.isPending ? 'Saving…' : 'Make default'}
                      </button>
                    )}
                    {item.matchedSender.fromAddress && (
                      <button
                        type="button"
                        className="ui-btn-action"
                        onClick={() => onTestEmail(item.matchedSender!)}
                      >
                        Send a test
                      </button>
                    )}
                    {item.matchedSender.mode === 'own' && !item.isDefault && (
                      <button
                        type="button"
                        className="ui-btn-action"
                        style={{ color: 'var(--danger, #dc2626)' }}
                        onClick={() => onRemoveSender(item.matchedSender!)}
                      >
                        Disconnect
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button type="button" className="ui-btn-action" onClick={onConfigure}>
                      Configure
                    </button>
                    <button
                      type="button"
                      className="ui-btn-action"
                      style={{ color: 'var(--danger, #dc2626)' }}
                      onClick={onDisconnectMock}
                    >
                      Disconnect
                    </button>
                  </>
                )}
              </>
            ) : (
              <button
                type="button"
                className="ui-btn-action ui-btn-primary"
                onClick={onConnect}
              >
                + Connect
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

/** "Use my own email": connect Gmail (Google's own sign-in) or an SMTP server. */
function AddSender({
  workspaceId,
  initialWay = 'choose',
  onClose,
}: {
  workspaceId: string
  initialWay?: 'choose' | 'smtp'
  onClose: () => void
}) {
  const createConnection = useCreateEmailConnection(workspaceId)
  const [way, setWay] = useState<'choose' | 'smtp'>(initialWay)
  const [connecting, setConnecting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [fromAddress, setFromAddress] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('587')
  const [security, setSecurity] = useState<'starttls' | 'implicit'>('starttls')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)

  const connectGmail = async () => {
    setErrorMsg(null)
    setConnecting(true)
    try {
      const res = await getApiClient().GET(
        '/workspaces/{workspaceId}/integrations/google/url' as never,
        { params: { path: { workspaceId } } } as never
      )
      const url = (res.data as { data?: { url?: string } } | undefined)?.data?.url
      if (!url) {
        throw new Error((res.error as { error?: string } | undefined)?.error ?? 'Gmail can’t be connected on this server yet.')
      }
      window.location.assign(url)
    } catch (err) {
      setConnecting(false)
      setErrorMsg(err instanceof Error ? err.message : 'Couldn’t start the Gmail connection.')
    }
  }

  const saveSmtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    const payload: CreateEmailConnectionInput = {
      strategy: 'smtp',
      displayName: displayName.trim(),
      fromAddress: fromAddress.trim(),
      replyTo: replyTo.trim() || undefined,
      smtp: {
        host: host.trim(),
        port: (parseInt(port, 10) || 587) as 25 | 465 | 587 | 2525,
        security,
        username: username.trim(),
        password,
      },
      makeDefault,
    }
    try {
      await createConnection.mutateAsync(payload)
      onClose()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Couldn’t add the sender.')
    }
  }

  return (
    <FormSlideout title="Connect Email Delivery" onClose={onClose}>
      {way === 'choose' ? (
        <div className="company-form" style={{ padding: 'var(--space-lg)' }}>
          <p className="company-note" style={{ marginTop: 0 }}>
            Automations and daily briefings will send directly from your domain or account.
          </p>
          <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
            <button
              type="button"
              className="ui-btn-action"
              disabled={connecting}
              onClick={() => void connectGmail()}
              style={{ justifyContent: 'center', height: '36px' }}
            >
              <IntegrationBrandIcon service="Google Workspace" />
              {connecting ? 'Opening Google…' : 'Connect Google Workspace / Gmail'}
            </button>
            <button
              type="button"
              className="ui-btn-action"
              onClick={() => setWay('smtp')}
              style={{ justifyContent: 'center', height: '36px' }}
            >
              Configure Custom SMTP Server
            </button>
          </div>
          {errorMsg && <p className="company-status" role="alert">{errorMsg}</p>}
        </div>
      ) : (
        <form className="company-form" onSubmit={saveSmtp} style={{ padding: 'var(--space-lg)' }}>
          <div className="record-form-fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label>
              <span>Sender Name</span>
              <input type="text" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            <label>
              <span>From Email Address</span>
              <input type="email" required value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} />
            </label>
            <label>
              <span>Reply-To Email (optional)</span>
              <input type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
            </label>
            <label>
              <span>SMTP Host</span>
              <input type="text" required placeholder="smtp.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
            </label>
            <label>
              <span>Port</span>
              <select value={port} onChange={(e) => setPort(e.target.value)}>
                {['587', '465', '2525', '25'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Security</span>
              <select value={security} onChange={(e) => setSecurity(e.target.value as 'starttls' | 'implicit')}>
                <option value="starttls">STARTTLS (587, 25)</option>
                <option value="implicit">TLS (465)</option>
              </select>
            </label>
            <label>
              <span>Username</span>
              <input type="text" required autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label>
              <span>Password / App Password</span>
              <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}>
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
            <span>Make this the default sender</span>
          </label>
          {errorMsg && <p className="company-status" role="alert">{errorMsg}</p>}
          <footer style={{ marginTop: 'var(--space-lg)' }}>
            <button type="button" className="company-go" onClick={() => setWay('choose')}>
              Back
            </button>
            <button type="submit" className="record-primary" disabled={createConnection.isPending}>
              {createConnection.isPending ? 'Checking…' : 'Save Connection'}
            </button>
          </footer>
        </form>
      )}
    </FormSlideout>
  )
}

