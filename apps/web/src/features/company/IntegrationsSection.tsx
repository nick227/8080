import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import {
  getApiClient,
  unwrap,
  useCreateEmailConnection,
  useDeleteEmailConnection,
  useEmailConnections,
  useUpdateEmailConnection,
  type CreateEmailConnectionInput,
  type EmailConnection,
} from '@project/sdk'
import { SectionHeader } from '../work/SectionHeader'
import { FormSlideout } from '../work/FormSlideout'
import { TestEmailSlideout } from './TestEmailSlideout'

type IntegrationRow = {
  id: string
  service: string
  category: 'Email' | 'CRM' | 'E-Commerce' | 'Social'
  authMethod: 'Domain' | 'OAuth' | 'API Key' | 'SMTP'
  defaultConnected?: boolean
  accountPattern?: string
  isSystem?: boolean
}

const INTEGRATIONS: IntegrationRow[] = [
  // Email Integrations - System email dynamically bound to company slug
  {
    id: 'system-email',
    service: 'System Email',
    category: 'Email',
    authMethod: 'Domain',
    defaultConnected: true,
    accountPattern: 'YOUR_SLUG.mail@hatsyshirtsy.com',
    isSystem: true,
  },
  {
    id: 'google-workspace',
    service: 'Google Workspace',
    category: 'Email',
    authMethod: 'OAuth',
    accountPattern: 'admin@YOUR_SLUG.com',
  },
  {
    id: 'microsoft-365',
    service: 'Microsoft 365',
    category: 'Email',
    authMethod: 'OAuth',
    accountPattern: 'business@YOUR_SLUG.com',
  },

  // CRM & E-Commerce Data Sources
  {
    id: 'hubspot',
    service: 'HubSpot',
    category: 'CRM',
    authMethod: 'OAuth',
    defaultConnected: true,
    accountPattern: 'Portal #849201',
  },
  {
    id: 'woocommerce',
    service: 'WooCommerce',
    category: 'E-Commerce',
    authMethod: 'API Key',
    defaultConnected: true,
    accountPattern: 'https://store.YOUR_SLUG.com',
  },
  {
    id: 'shopify',
    service: 'Shopify',
    category: 'E-Commerce',
    authMethod: 'OAuth',
    accountPattern: 'https://YOUR_SLUG.myshopify.com',
  },
  {
    id: 'salesforce',
    service: 'Salesforce',
    category: 'CRM',
    authMethod: 'OAuth',
    accountPattern: 'org-YOUR_SLUG.salesforce.com',
  },

  // Social Media Autoposting
  {
    id: 'linkedin',
    service: 'LinkedIn',
    category: 'Social',
    authMethod: 'OAuth',
    defaultConnected: true,
    accountPattern: '@YOUR_SLUG',
  },
  {
    id: 'x-twitter',
    service: 'X (Twitter)',
    category: 'Social',
    authMethod: 'OAuth',
    accountPattern: '@YOUR_SLUG',
  },
  {
    id: 'meta-facebook-ig',
    service: 'Meta (FB & IG)',
    category: 'Social',
    authMethod: 'OAuth',
    accountPattern: 'FB & IG @YOUR_SLUG',
  },
  {
    id: 'tiktok',
    service: 'TikTok',
    category: 'Social',
    authMethod: 'OAuth',
    accountPattern: '@YOUR_SLUG',
  },
  {
    id: 'youtube',
    service: 'YouTube',
    category: 'Social',
    authMethod: 'OAuth',
    accountPattern: 'Channel @YOUR_SLUG',
  },
]

type SortField = 'service' | 'category' | 'account' | 'authMethod' | 'status'

type UnifiedRow = {
  id: string
  service: string
  category: string
  account: string
  authMethod: string
  status: string
  isConnected: boolean
  isSystem?: boolean
  isDefault?: boolean
  isSdk?: boolean
  connectionId?: string
  fromAddress?: string
  rawItem?: IntegrationRow
  rawSdk?: EmailConnection
}

export function IntegrationsSection({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const list = useEmailConnections(workspaceId)
  const createConnection = useCreateEmailConnection(workspaceId)
  const updateConnection = useUpdateEmailConnection(workspaceId, '')
  const deleteConnection = useDeleteEmailConnection(workspaceId)

  // Column sorting state
  const [sortField, setSortField] = useState<SortField>('service')
  const [sortAsc, setSortAsc] = useState(true)

  // Test Slideout modal state
  const [testSlideout, setTestSlideout] = useState<{
    senderLabel: string
    senderFromAddress?: string
    connectionId?: string
  } | null>(null)

  // Fetch company slug to render dynamic domain email address & account handles
  const profileQuery = useQuery({
    queryKey: ['company-profile', workspaceId],
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/company-profile', { params: { path: { workspaceId } } })).data as {
        facts?: { kind: string; value: string }[]
      },
  })

  const companySlug =
    profileQuery.data?.facts?.find((f) => f.kind === 'company_slug')?.value ||
    profileQuery.data?.facts?.find((f) => f.kind === 'company_name')?.value?.toLowerCase().replace(/\s+/g, '-') ||
    'business'

  // Connected state for mock integrations
  const [connectedState, setConnectedState] = useState<Record<string, boolean>>({
    hubspot: true,
    woocommerce: true,
    linkedin: true,
  })

  const [activeOAuthModal, setActiveOAuthModal] = useState<IntegrationRow | null>(null)
  const [oauthStep, setOauthStep] = useState<'prompt' | 'authorizing' | 'success'>('prompt')

  // Custom Key / Store URL inputs for API key integrations
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [storeUrlInput, setStoreUrlInput] = useState('')

  // Custom SMTP Form state
  const [showSmtpForm, setShowSmtpForm] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [fromAddress, setFromAddress] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [host, setHost] = useState('smtp.gmail.com')
  const [port, setPort] = useState('587')
  const [security, setSecurity] = useState<'starttls' | 'implicit'>('starttls')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleCreateSmtp = async (e: React.FormEvent) => {
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
      setShowSmtpForm(false)
      setDisplayName('')
      setFromAddress('')
      setReplyTo('')
      setUsername('')
      setPassword('')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not add SMTP sender')
    }
  }

  const handleMakeDefault = async (conn: EmailConnection) => {
    setErrorMsg(null)
    try {
      await updateConnection.mutateAsync({ makeDefault: true })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not set default sender')
    }
  }

  const handleDeleteSmtp = async (id: string) => {
    setErrorMsg(null)
    try {
      await deleteConnection.mutateAsync(id)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not delete sender')
    }
  }

  const openOAuthModal = async (item: IntegrationRow) => {
    if (item.id === 'google-workspace') {
      try {
        const res = await getApiClient().GET('/workspaces/{workspaceId}/email-connections/google/url' as any, {
          params: { path: { workspaceId } },
        })
        const url = (res.data as any)?.data?.url
        if (url) {
          window.location.href = url
          return
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Could not start Google connection')
      }
    }
    setActiveOAuthModal(item)
    setOauthStep('prompt')
    setApiKeyInput('')
    setStoreUrlInput(item.id === 'woocommerce' ? `https://store.${companySlug}.com` : '')
  }

  const handleAuthorizeOAuth = () => {
    if (!activeOAuthModal) return
    setOauthStep('authorizing')
    setTimeout(() => {
      setConnectedState((prev) => ({ ...prev, [activeOAuthModal.id]: true }))
      setOauthStep('success')
    }, 800)
  }

  const handleToggleConnect = (item: IntegrationRow) => {
    const isConnected = item.isSystem || !!connectedState[item.id]
    if (isConnected && !item.isSystem) {
      if (window.confirm(`Disconnect ${item.service}?`)) {
        setConnectedState((prev) => ({ ...prev, [item.id]: false }))
      }
    } else if (!isConnected) {
      openOAuthModal(item)
    }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(true)
    }
  }

  // Combine integrations and SDK custom SMTP senders (filtering out SDK platform mode to eliminate redundant "Send with 8080")
  const unifiedRows = useMemo<UnifiedRow[]>(() => {
    const platformConnection = (list.data ?? []).find((c) => c.mode === 'platform' || c.strategy === 'platform')

    const staticRows: UnifiedRow[] = INTEGRATIONS.map((row) => {
      const isConnected = row.isSystem || !!connectedState[row.id]
      const account = isConnected && row.accountPattern ? row.accountPattern.replace('YOUR_SLUG', companySlug) : '—'
      const status = row.isSystem ? 'Default' : isConnected ? 'Connected' : 'Not connected'
      const fromAddr = row.isSystem ? `${companySlug}.mail@hatsyshirtsy.com` : undefined
      return {
        id: row.id,
        service: row.service,
        category: row.category,
        account,
        authMethod: row.authMethod,
        status,
        isConnected,
        isSystem: row.isSystem,
        connectionId: row.isSystem ? platformConnection?.id : undefined,
        fromAddress: fromAddr,
        rawItem: row,
      }
    })

    // Exclude SDK connections where mode === 'platform' to avoid duplicating System Email ("Send with 8080")
    const sdkCustomRows: UnifiedRow[] = (list.data ?? [])
      .filter((row) => row.mode !== 'platform')
      .map((row) => ({
        id: row.id,
        service: row.label || 'Custom SMTP',
        category: 'Email',
        account: row.fromAddress || row.smtp?.host || 'SMTP Server',
        authMethod: 'SMTP',
        status: row.isDefault ? 'Default' : row.status || 'Connected',
        isConnected: true,
        isDefault: row.isDefault,
        isSdk: true,
        connectionId: row.id,
        fromAddress: row.fromAddress ?? undefined,
        rawSdk: row,
      }))

    const combined = [...staticRows, ...sdkCustomRows]

    return combined.sort((a, b) => {
      const valA = (a[sortField] || '').toLowerCase()
      const valB = (b[sortField] || '').toLowerCase()
      if (valA < valB) return sortAsc ? -1 : 1
      if (valA > valB) return sortAsc ? 1 : -1
      return 0
    })
  }, [connectedState, companySlug, list.data, sortField, sortAsc])

  return (
    <section className="company-group" aria-labelledby="company-integrations-title">
      <SectionHeader
        title="Integrations"
        titleId="company-integrations-title"
        newLabel="Add SMTP Mail"
        onNew={canEdit && !showSmtpForm ? () => setShowSmtpForm(true) : undefined}
      />

      <div className="integrations-table-container">
        <table className="integrations-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('service')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Service {sortField === 'service' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th onClick={() => handleSort('category')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Category {sortField === 'category' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th onClick={() => handleSort('account')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Account / Endpoint {sortField === 'account' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th onClick={() => handleSort('authMethod')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Auth Method {sortField === 'authMethod' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th onClick={() => handleSort('status')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Status {sortField === 'status' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {unifiedRows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.service}</strong>
                </td>
                <td>{row.category}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: '0.825rem' }}>{row.account}</td>
                <td>{row.authMethod}</td>
                <td>
                  <span
                    className="status-pill"
                    data-status={row.isSystem || row.isDefault ? 'default' : row.isConnected ? 'connected' : 'disconnected'}
                  >
                    {row.status}
                  </span>
                </td>
                <td>
                  <div className="actions-cell">
                    {canEdit && !row.isSystem && row.rawItem && (
                      <button
                        type="button"
                        className={row.isConnected ? 'company-go' : 'section-add-btn'}
                        style={row.isConnected ? { color: 'var(--muted)' } : undefined}
                        onClick={() => handleToggleConnect(row.rawItem!)}
                      >
                        {row.isConnected ? 'Disconnect' : 'Connect'}
                      </button>
                    )}
                    {canEdit && row.isSdk && row.rawSdk && !row.rawSdk.isDefault && (
                      <button
                        type="button"
                        className="company-go"
                        onClick={() => handleMakeDefault(row.rawSdk!)}
                      >
                        Make default
                      </button>
                    )}
                    {canEdit && row.isSdk && row.rawSdk && row.rawSdk.mode === 'own' && !row.rawSdk.isDefault && (
                      <button
                        type="button"
                        className="company-go"
                        style={{ color: 'var(--danger, #dc2626)' }}
                        onClick={() => handleDeleteSmtp(row.id)}
                      >
                        Remove
                      </button>
                    )}
                    {row.isConnected && (
                      <button
                        type="button"
                        className="section-add-btn"
                        onClick={() =>
                          setTestSlideout({
                            senderLabel: row.service,
                            senderFromAddress: row.fromAddress || row.account,
                            connectionId: row.connectionId,
                          })
                        }
                      >
                        Test
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {errorMsg && (
        <p className="company-status" role="alert" style={{ color: 'var(--danger, #dc2626)', paddingInline: 'var(--table-cell-padding-x)' }}>
          {errorMsg}
        </p>
      )}

      {/* Test Email Slideout */}
      {testSlideout && (
        <TestEmailSlideout
          workspaceId={workspaceId}
          senderLabel={testSlideout.senderLabel}
          senderFromAddress={testSlideout.senderFromAddress}
          connectionId={testSlideout.connectionId}
          onClose={() => setTestSlideout(null)}
        />
      )}

      {/* 1-Touch OAuth / Credential Setup Slideout */}
      {activeOAuthModal && (
        <FormSlideout title={`Connect ${activeOAuthModal.service}`} onClose={() => setActiveOAuthModal(null)}>
          <div className="oauth-modal-card">
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{activeOAuthModal.service} Integration</h3>
              <span className="status-pill" data-status="connected" style={{ marginTop: '0.25rem' }}>
                {activeOAuthModal.authMethod}
              </span>
            </div>

            {oauthStep === 'prompt' && (
              <>
                <div className="oauth-modal-status">
                  <strong>Authorize Connection</strong>
                  <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)' }}>
                    Authorizing for workspace <code>{companySlug}</code>.
                  </p>
                </div>

                {activeOAuthModal.id === 'woocommerce' && (
                  <div className="record-form-fields" style={{ padding: 0 }}>
                    <label>
                      <span>Store URL</span>
                      <input
                        type="url"
                        value={storeUrlInput}
                        onChange={(e) => setStoreUrlInput(e.target.value)}
                        placeholder="https://store.acme.com"
                      />
                    </label>
                    <label>
                      <span>Consumer Key (API Key)</span>
                      <input
                        type="text"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="ck_..."
                      />
                    </label>
                  </div>
                )}

                <footer>
                  <button type="button" className="company-go" onClick={() => setActiveOAuthModal(null)}>
                    Cancel
                  </button>
                  <button type="button" className="record-primary" onClick={handleAuthorizeOAuth}>
                    Authorize Connection
                  </button>
                </footer>
              </>
            )}

            {oauthStep === 'authorizing' && (
              <div className="oauth-modal-status" style={{ textAlign: 'center', padding: '2rem' }}>
                <p style={{ margin: 0, fontWeight: 500 }}>Connecting…</p>
              </div>
            )}

            {oauthStep === 'success' && (
              <div className="oauth-modal-status" style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                <strong style={{ color: '#10b981' }}>Successfully Connected!</strong>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)' }}>
                  {activeOAuthModal.service} is now connected for workspace <strong>{companySlug}</strong>.
                </p>
                <footer style={{ marginTop: '1rem' }}>
                  <button type="button" className="record-primary" onClick={() => setActiveOAuthModal(null)}>
                    Done
                  </button>
                </footer>
              </div>
            )}
          </div>
        </FormSlideout>
      )}

      {/* Custom SMTP Slideout / Form */}
      {showSmtpForm && canEdit && (
        <FormSlideout title="New Custom SMTP Mail Connection" onClose={() => setShowSmtpForm(false)}>
          <form className="company-form" onSubmit={handleCreateSmtp} style={{ padding: 'var(--space-lg)' }}>
            <div className="record-form-fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label>
                <span>Display Name</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Support Mail"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>

              <label>
                <span>From Email Address</span>
                <input
                  type="email"
                  required
                  placeholder={`support@${companySlug}.com`}
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                />
              </label>

              <label>
                <span>Reply-To Email Address (Optional)</span>
                <input
                  type="email"
                  placeholder={`help@${companySlug}.com`}
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                />
              </label>

              <label>
                <span>SMTP Host</span>
                <input
                  type="text"
                  required
                  placeholder="smtp.gmail.com"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </label>

              <label>
                <span>SMTP Port</span>
                <input
                  type="number"
                  required
                  placeholder="587"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </label>

              <label>
                <span>Security</span>
                <select
                  value={security}
                  onChange={(e) => setSecurity(e.target.value as 'starttls' | 'implicit')}
                >
                  <option value="starttls">STARTTLS (587 / 25)</option>
                  <option value="implicit">Implicit TLS (465)</option>
                </select>
              </label>

              <label>
                <span>Mailbox Username</span>
                <input
                  type="text"
                  required
                  placeholder={`support@${companySlug}.com`}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>

              <label>
                <span>App Password</span>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>

            <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}>
              <input
                type="checkbox"
                checked={makeDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
              />
              <span>Make this sender the default for new Agents</span>
            </label>

            <footer>
              <button
                type="button"
                className="company-go"
                onClick={() => setShowSmtpForm(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="record-primary"
                disabled={createConnection.isPending}
              >
                {createConnection.isPending ? 'Saving…' : 'Save SMTP Mail'}
              </button>
            </footer>
          </form>
        </FormSlideout>
      )}
    </section>
  )
}

