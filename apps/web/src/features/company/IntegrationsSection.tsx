import { useState } from 'react'
import {
  useCreateEmailConnection,
  useDeleteEmailConnection,
  useEmailConnections,
  useTestEmailConnection,
  useUpdateEmailConnection,
  type CreateEmailConnectionInput,
  type EmailConnection,
} from '@project/sdk'
import { SectionHeader } from '../work/SectionHeader'

export function IntegrationsSection({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const list = useEmailConnections(workspaceId)
  const createConnection = useCreateEmailConnection(workspaceId)
  const updateConnection = useUpdateEmailConnection(workspaceId, '')
  const deleteConnection = useDeleteEmailConnection(workspaceId)
  const testConnection = useTestEmailConnection(workspaceId)

  const [showAddForm, setShowAddForm] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [fromAddress, setFromAddress] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [host, setHost] = useState('smtp.gmail.com')
  const [port, setPort] = useState('587')
  const [security, setSecurity] = useState<'starttls' | 'implicit'>('starttls')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)

  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message?: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleCreate = async (e: React.FormEvent) => {
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
      setShowAddForm(false)
      setDisplayName('')
      setFromAddress('')
      setReplyTo('')
      setUsername('')
      setPassword('')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not add sender')
    }
  }

  const handleTest = async (id: string) => {
    setTestResult(null)
    setErrorMsg(null)
    try {
      const res = await testConnection.mutateAsync(id)
      setTestResult({ id, ok: res.ok, message: res.error?.message })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Test failed')
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

  const handleDelete = async (id: string) => {
    setErrorMsg(null)
    try {
      await deleteConnection.mutateAsync(id)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not delete sender')
    }
  }

  return (
    <section className="company-group" aria-labelledby="company-integrations-title">
      <SectionHeader
        title="Email Senders"
        titleId="company-integrations-title"
        newLabel="Sender"
        onNew={canEdit && !showAddForm ? () => setShowAddForm(true) : undefined}
      />

      {list.isLoading && (
        <p className="company-status" role="status">
          Loading…
        </p>
      )}
      {list.isError && (
        <p className="company-status" role="status">
          Couldn’t load integrations.
        </p>
      )}

      {list.data && (
        <ul className="company-list">
          {list.data.map((row) => (
            <li key={row.id} className="company-integration">
              <div>
                <button type="button" className="company-link" disabled>
                  {row.label}
                </button>
                <p className="company-quiet">
                  {row.mode === 'platform' ? 'Built-in platform sender (Send with 8080)' : `SMTP (${row.smtp?.host ?? 'Custom'})`}
                  {row.fromAddress ? ` · ${row.fromAddress}` : ''}
                  {row.isDefault ? ' · Workspace Default' : ''}
                  {` · ${row.status}`}
                </p>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {!row.isDefault && (
                    <button
                      type="button"
                      className="company-go"
                      onClick={() => handleMakeDefault(row)}
                    >
                      Make default
                    </button>
                  )}
                  {row.mode === 'own' && !row.isDefault && (
                    <button
                      type="button"
                      className="company-go"
                      style={{ color: 'var(--danger, #dc2626)' }}
                      onClick={() => handleDelete(row.id)}
                    >
                      Remove
                    </button>
                  )}
                  <button
                    type="button"
                    className="section-add-btn"
                    disabled={testConnection.isPending}
                    onClick={() => handleTest(row.id)}
                  >
                    {testConnection.isPending ? 'Testing…' : 'Send test'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {testResult && (
        <p className="company-status" role="status">
          {testResult.ok ? 'Test sent successfully.' : `Test failed: ${testResult.message ?? 'Check credentials'}`}
        </p>
      )}
      {errorMsg && <p className="company-status" role="alert" style={{ color: 'var(--danger, #dc2626)' }}>{errorMsg}</p>}

      {showAddForm && canEdit && (
        <form className="company-form" onSubmit={handleCreate} style={{ marginTop: '1rem' }}>
          <div className="record-form-fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label>
              <span>Display Name</span>
              <input
                type="text"
                required
                placeholder="e.g. Acme Sales"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>

            <label>
              <span>From Email Address</span>
              <input
                type="email"
                required
                placeholder="e.g. sales@acme.com"
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
              />
            </label>

            <label>
              <span>Reply-To Email Address (Optional)</span>
              <input
                type="email"
                placeholder="e.g. support@acme.com"
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
                placeholder="sales@acme.com"
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
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="record-primary"
              disabled={createConnection.isPending}
            >
              {createConnection.isPending ? 'Saving…' : 'Save SMTP Sender'}
            </button>
          </footer>
        </form>
      )}
    </section>
  )
}
