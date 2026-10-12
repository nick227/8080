// Push delivery diagnostics (staff only). How far notifications get, each stage measured
// separately (accepted by the push service, displayed on the device, opened), what failed,
// and recent deliveries. States, devices and errors only: never message content.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminSession, usePushDiagnostics, type PushDiagnosticsQuery } from '@project/sdk'
import { SEO } from '../../components/SEO'
import './admin.css'
import './admin-push.css'

type Status = NonNullable<PushDiagnosticsQuery['status']>
const STATUSES: Status[] = ['pending', 'accepted', 'displayed', 'opened', 'failed', 'cancelled']

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—')
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—')

export function AdminPush() {
  const session = useAdminSession()
  const [days, setDays] = useState(7)
  const [status, setStatus] = useState<Status | undefined>()
  const diag = usePushDiagnostics({ days, status, limit: 100 }, !!session.data)
  const d = diag.data
  return (
    <div className="admin-app">
      <SEO title="Push · 8080 Admin" description="Push notification delivery diagnostics" />
      <aside className="admin-sidebar">
        <Link className="admin-brand" to="/">8080 <span>Admin</span></Link>
        <nav aria-label="Administration">
          <Link to="/admin">Users</Link>
          <Link to="/admin/blueprints">Blueprints</Link>
          <Link to="/admin/billing">Billing</Link>
          <Link to="/admin/settings">Settings</Link>
          <Link to="/admin/push" aria-current="page">Push</Link>
        </nav>
        <Link className="admin-return" to="/account">← Back to account</Link>
      </aside>
      <main className="admin-main">
        <header className="admin-heading">
          <div><p>Delivery</p><h1>Push notifications</h1></div>
          <label className="admin-push-range">Last
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 7, 30, 90].map((n) => <option key={n} value={n}>{n === 1 ? '24 hours' : `${n} days`}</option>)}
            </select>
          </label>
        </header>
        {session.error || diag.error ? <p role="alert">{(session.error ?? diag.error)?.message}</p> : !d ? <p role="status">Loading deliveries…</p> : (
          <>
            <div className="admin-stats-grid">
              <Stat label="Deliveries" value={String(d.total)} sub={`${d.devices} device${d.devices === 1 ? '' : 's'} registered now`} />
              <Stat label="Accepted by push service" value={pct(d.stages.accepted, d.total)} sub={`${d.stages.accepted} of ${d.total} · ${d.unconfirmed} unconfirmed`} />
              <Stat label="Displayed (device-reported)" value={pct(d.stages.displayed, d.total)} sub={`${d.stages.displayed} of ${d.total}`} />
              <Stat label="Opened (device-reported)" value={pct(d.stages.opened, d.total)} sub={`${d.stages.opened} of ${d.total}`} />
            </div>
            <p className="admin-muted">Each stage is measured on its own. Accepted means the push service took the message. Displayed and opened are what the device's app reported: the phone put the notification up, which is not proof a person saw it. An accepted delivery with no report is unconfirmed, not undelivered: a phone that is offline, or closes the app before it can report, shows nothing here.</p>

            <section className="admin-settings-section">
              <h2>Right now</h2>
              <dl className="admin-facts">
                {STATUSES.map((s) => <div key={s}><dt>{s}</dt><dd>{d.now[s]}</dd></div>)}
              </dl>
            </section>

            {d.failures.length > 0 && (
              <section className="admin-settings-section admin-push-wide">
                <h2>Failures</h2>
                <table className="admin-push-table">
                  <thead><tr><th>Push service</th><th>Response</th><th>Deliveries</th></tr></thead>
                  <tbody>{d.failures.map((f) => <tr key={`${f.pushHost}:${f.statusCode}`}><td>{f.pushHost}</td><td>{f.statusCode ?? 'No response'}</td><td>{f.count}</td></tr>)}</tbody>
                </table>
              </section>
            )}

            <section className="admin-settings-section admin-push-wide">
              <h2>Recent deliveries</h2>
              <div className="admin-filter-pills" role="group" aria-label="Status">
                <button type="button" className={`admin-filter-pill${status ? '' : ' active'}`} aria-pressed={!status} onClick={() => setStatus(undefined)}>All</button>
                {STATUSES.map((s) => <button key={s} type="button" className={`admin-filter-pill${status === s ? ' active' : ''}`} aria-pressed={status === s} onClick={() => setStatus(status === s ? undefined : s)}>{s}</button>)}
              </div>
              {d.recent.length === 0 ? <p className="admin-muted">No deliveries in this period.</p> : (
                <div className="admin-push-scroll">
                  <table className="admin-push-table">
                    <thead><tr><th>Created</th><th>Person</th><th>Device</th><th>Kind</th><th>Status</th><th>Tries</th><th>Accepted</th><th>Displayed</th><th>Opened</th><th>Last error</th></tr></thead>
                    <tbody>
                      {d.recent.map((r) => (
                        <tr key={r.id}>
                          <td>{when(r.createdAt)}</td>
                          <td title={r.user.email ?? r.user.id}>{r.user.displayName || r.user.email || r.user.id}</td>
                          <td title={r.pushHost}>{r.device ?? r.pushHost}</td>
                          <td>{r.kind}</td>
                          <td><span className="admin-push-status" data-status={r.status}>{r.status}</span>{r.status === 'pending' && r.nextAttemptAt && <small> next {when(r.nextAttemptAt)}</small>}</td>
                          <td>{r.attempts}</td>
                          <td>{when(r.acceptedAt)}</td>
                          <td>{when(r.displayedAt)}</td>
                          <td>{when(r.openedAt)}</td>
                          <td className="admin-push-error">{r.lastError ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="admin-stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <small className="stat-sub">{sub}</small>
    </div>
  )
}
