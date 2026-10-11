import { useEffect, useState } from 'react'
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
import { Card, CardContent, CardHeader } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { IntegrationBrandIcon, PlugIcon } from '../../components/icons'
import { FormSlideout } from '../work/FormSlideout'
import { TestEmailSlideout } from './TestEmailSlideout'

// Only what the server knows (redesign rule: no fabricated data). Email senders are the
// one integration that exists: "Send with 8080" or the company's own email (docs/agents
// S5); how an own sender connects (Gmail, SMTP) is a detail of adding one.

const STATUS: Record<EmailConnection['status'], { label: string; variant: 'connected' | 'warning' | 'disconnected' }> = {
  active: { label: 'Active', variant: 'connected' },
  needs_attention: { label: 'Needs attention', variant: 'warning' },
  disabled: { label: 'Disabled', variant: 'disconnected' },
}

const VIA: Record<EmailConnection['strategy'], string> = {
  platform: '8080',
  smtp: 'SMTP server',
  google: 'Gmail',
  microsoft: 'Microsoft 365',
  resend_domain: 'Your domain',
}

// What the Gmail callback reports back on the address bar (never shown verbatim: a link
// could carry any text).
const GMAIL_ERRORS: Record<string, string> = {
  canceled: 'Gmail wasn’t connected: the Google sign-in was canceled.',
  access_denied: 'Gmail wasn’t connected: access was not granted.',
  invalid_state: 'Gmail wasn’t connected: the request expired. Try again.',
  unauthorized: 'Gmail wasn’t connected: only the admin who started it can finish it, in the same browser.',
}

export function IntegrationsSection({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const list = useEmailConnections(workspaceId)
  const deleteConnection = useDeleteEmailConnection(workspaceId)
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(false)
  const [testing, setTesting] = useState<EmailConnection | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  // Report the Gmail callback's outcome once, then drop it from the address.
  useEffect(() => {
    const ok = params.get('gmailSuccess')
    const error = params.get('gmailError')
    if (!ok && !error) return
    setNotice(ok ? { ok: true, text: 'Gmail connected. Make it the default to send automations from it.' } : { ok: false, text: GMAIL_ERRORS[error!] ?? 'Gmail wasn’t connected. Try again, or use an SMTP server.' })
    const next = new URLSearchParams(params)
    next.delete('gmailSuccess')
    next.delete('gmailError')
    setParams(next, { replace: true })
  }, [params, setParams])

  const remove = async (conn: EmailConnection) => {
    if (!window.confirm(`Remove ${conn.label}? Automations using it switch to the default sender.`)) return
    setNotice(null)
    try {
      await deleteConnection.mutateAsync(conn.id)
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Couldn’t remove the sender.' })
    }
  }

  const senders = list.data ?? []
  return (
    <section className="company-group" aria-labelledby="company-integrations-title">
      <Card style={{ marginTop: 'var(--space-lg)' }}>
        <CardHeader
          icon={<PlugIcon />}
          title={<span id="company-integrations-title">Email senders</span>}
          description="Who automations send email as. Every company can send with 8080; add your own email to send from your address."
          actions={canEdit ? (
            <button type="button" className="ui-btn-action" onClick={() => setAdding(true)}>
              <span>+ Use my own email</span>
            </button>
          ) : null}
        />
        <CardContent style={{ padding: 0 }}>
          {notice && <p className="company-status" role={notice.ok ? 'status' : 'alert'} data-ok={notice.ok || undefined}>{notice.text}</p>}
          {list.isLoading ? <p className="company-status" role="status">Loading senders…</p>
            : list.isError ? <p className="company-status" role="alert">Couldn’t load senders.</p>
              : (
                <div className="integrations-table-container" style={{ padding: 0 }}>
                  <table className="integrations-table">
                    <thead>
                      <tr>
                        <th scope="col">Sender</th>
                        <th scope="col">Sends from</th>
                        <th scope="col">Replies to</th>
                        <th scope="col">Status</th>
                        <th scope="col" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {senders.map((conn) => (
                        <SenderRow key={conn.id} workspaceId={workspaceId} conn={conn} canEdit={canEdit}
                          onTest={() => setTesting(conn)} onRemove={() => void remove(conn)} onError={(text) => setNotice({ ok: false, text })} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          <p className="company-status company-note">Other integrations (CRM, online store, social accounts) aren’t available yet.</p>
        </CardContent>
      </Card>

      {testing && (
        <TestEmailSlideout
          workspaceId={workspaceId}
          senderLabel={testing.label}
          senderFromAddress={testing.fromAddress ?? undefined}
          connectionId={testing.id}
          onClose={() => setTesting(null)}
        />
      )}

      {adding && canEdit && <AddSender workspaceId={workspaceId} onClose={() => setAdding(false)} />}
    </section>
  )
}

function SenderRow({ workspaceId, conn, canEdit, onTest, onRemove, onError }: {
  workspaceId: string
  conn: EmailConnection
  canEdit: boolean
  onTest: () => void
  onRemove: () => void
  onError: (text: string) => void
}) {
  const update = useUpdateEmailConnection(workspaceId, conn.id)
  const status = STATUS[conn.status]
  const makeDefault = async () => {
    try {
      await update.mutateAsync({ makeDefault: true })
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Couldn’t make it the default.')
    }
  }
  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <IntegrationBrandIcon service={conn.strategy === 'platform' ? 'System Email' : VIA[conn.strategy]} />
          <div>
            <strong>{conn.label}</strong>
            {conn.mode === 'own' && <div className="company-note">via {VIA[conn.strategy]}</div>}
          </div>
        </div>
      </td>
      <td style={{ fontFamily: 'var(--mono)', fontSize: '0.825rem' }}>
        {conn.fromAddress ?? <span className="company-note">Not set up on this server</span>}
      </td>
      <td style={{ fontFamily: 'var(--mono)', fontSize: '0.825rem' }}>{conn.replyTo ?? '—'}</td>
      <td>
        <span style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap' }}>
          {conn.isDefault && <Badge variant="default">Default</Badge>}
          <Badge variant={status.variant} title={conn.lastError ?? undefined}>{status.label}</Badge>
        </span>
      </td>
      <td>
        {canEdit && (
          <div className="actions-cell">
            {!conn.isDefault && conn.status === 'active' && (
              <button type="button" className="ui-btn-action" disabled={update.isPending} onClick={() => void makeDefault()}>
                {update.isPending ? 'Saving…' : 'Make default'}
              </button>
            )}
            {conn.fromAddress && (
              <button type="button" className="ui-btn-action" onClick={onTest}>Send a test</button>
            )}
            {conn.mode === 'own' && !conn.isDefault && (
              <button type="button" className="ui-btn-action" style={{ color: 'var(--danger, #dc2626)' }} onClick={onRemove}>Remove</button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

/** "Use my own email": connect Gmail (Google's own sign-in) or an SMTP server. */
function AddSender({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const createConnection = useCreateEmailConnection(workspaceId)
  const [way, setWay] = useState<'choose' | 'smtp'>('choose')
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
      // Outside the API spec: a browser redirect flow (server handlers/agents.ts).
      const res = await getApiClient().GET('/workspaces/{workspaceId}/integrations/google/url' as never, { params: { path: { workspaceId } } } as never)
      const url = (res.data as { data?: { url?: string } } | undefined)?.data?.url
      if (!url) throw new Error((res.error as { error?: string } | undefined)?.error ?? 'Gmail can’t be connected on this server yet.')
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
    <FormSlideout title="Use my own email" onClose={onClose}>
      {way === 'choose' ? (
        <div className="company-form" style={{ padding: 'var(--space-lg)' }}>
          <p className="company-note" style={{ marginTop: 0 }}>Automations will be able to send from your address. Choose how to connect it.</p>
          <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
            <button type="button" className="ui-btn-action" disabled={connecting} onClick={() => void connectGmail()}>
              <IntegrationBrandIcon service="Google Workspace" /> {connecting ? 'Opening Google…' : 'Connect Gmail or Google Workspace'}
            </button>
            <button type="button" className="ui-btn-action" onClick={() => setWay('smtp')}>Use an SMTP server</button>
          </div>
          {errorMsg && <p className="company-status" role="alert">{errorMsg}</p>}
        </div>
      ) : (
        <form className="company-form" onSubmit={saveSmtp} style={{ padding: 'var(--space-lg)' }}>
          <div className="record-form-fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label>
              <span>Name recipients see</span>
              <input type="text" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            <label>
              <span>Send from</span>
              <input type="email" required value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} />
            </label>
            <label>
              <span>Replies to (optional)</span>
              <input type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
            </label>
            <label>
              <span>SMTP host</span>
              <input type="text" required placeholder="smtp.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
            </label>
            <label>
              <span>Port</span>
              <select value={port} onChange={(e) => setPort(e.target.value)}>
                {['587', '465', '2525', '25'].map((p) => <option key={p} value={p}>{p}</option>)}
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
              <span>Password or app password</span>
              <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}>
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
            <span>Make this the default sender</span>
          </label>
          {errorMsg && <p className="company-status" role="alert">{errorMsg}</p>}
          <footer>
            <button type="button" className="company-go" onClick={() => setWay('choose')}>Back</button>
            <button type="submit" className="record-primary" disabled={createConnection.isPending}>
              {createConnection.isPending ? 'Checking…' : 'Add sender'}
            </button>
          </footer>
        </form>
      )}
    </FormSlideout>
  )
}
