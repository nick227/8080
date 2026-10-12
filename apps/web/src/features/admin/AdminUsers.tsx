import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, useAdminSession, useAdminUsers, useAdminUser, useAdminUserChange, useAdminChangePreview, type AdminUserDetail, type AdminUserChange } from '@project/sdk'
import { SEO } from '../../components/SEO'
import './admin.css'
import { AdminUserBilling } from './AdminUserBilling'

const dates = (value: string | null) => value ? new Date(value).toLocaleString() : '—'
type ActionSelection = { action: AdminUserChange['action']; grantId?: string }
const actionNames: Record<AdminUserChange['action'], string> = {
  suspend: 'Suspend account', reactivate: 'Reactivate account', grant_premium: 'Grant Premium', revoke_premium: 'Revoke complimentary Premium',
}
export function AdminUsers() {
  const session = useAdminSession()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [params, setParams] = useSearchParams()
  const userId = params.get('user')
  const users = useAdminUsers(query, cursors[cursors.length - 1], !!session.data)
  const detail = useAdminUser(userId, !!session.data)
  const [action, setAction] = useState<ActionSelection | null>(null)
  const [notice, setNotice] = useState('')
  const selectUser = (id: string | null) => { setAction(null); setNotice(''); setParams(id ? { user: id } : {}) }
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setCursors([undefined]) }, 250)
    return () => clearTimeout(timer)
  }, [search])
  return <div className="admin-app">
    <SEO title="Users · 8080 Admin" description="8080 platform administration" />
    <aside className="admin-sidebar">
      <Link className="admin-brand" to="/">8080 <span>Admin</span></Link>
      <nav aria-label="Administration">
        <Link to="/admin" aria-current="page">Users</Link>
        <Link to="/admin/blueprints">Blueprints</Link>
        <Link to="/admin/billing">Billing</Link>
        <Link to="/admin/settings">Settings</Link>
      </nav>
      <Link className="admin-return" to="/account">← Back to account</Link>
    </aside>
    <main className="admin-main">
      <header className="admin-heading"><div><p>Platform access</p><h1>Users</h1></div><span>Account roles · Personal Premium</span></header>
      {session.isPending ? <p role="status">Checking staff access…</p> : session.error ? <div className="admin-empty" role="alert"><h2>Staff access required</h2><p>{session.error instanceof ApiError && session.error.status === 403 ? 'Your workspace role does not grant platform administration.' : session.error.message}</p><Link to="/account">Go to your account</Link><button onClick={() => void session.refetch()}>Retry</button></div> : <>
        <div className="admin-search"><label htmlFor="admin-search">Find a user</label><input id="admin-search" type="search" placeholder="Name, email, or user ID" maxLength={120} value={search} onChange={e => setSearch(e.target.value)} /></div>
        {notice && <p className="admin-notice" role="status">{notice}</p>}
        <div className={`admin-workbench${userId ? ' has-detail' : ''}`}>
          <section aria-label="Users" className="admin-list">
            {users.isPending ? <p role="status">Loading users…</p> : users.error ? <div role="alert"><p>{users.error.message}</p><button onClick={() => void users.refetch()}>Retry</button></div> : <>
              <div className="admin-list-label"><span>User</span><span>Access</span></div>
              {users.data?.data.length === 0 && <p className="admin-empty">No users match this search.</p>}
              {users.data?.data.map(user => <button key={user.id} className="admin-user-row" aria-pressed={userId === user.id} onClick={() => selectUser(user.id)}>
                <span><strong>{user.displayName}</strong><small>{user.email ?? (user.isGuest ? 'Guest account' : user.id)}</small>{user.staffRole && <small>{user.staffRole === 'platform_owner' ? 'Platform owner' : 'Platform admin'}</small>}</span>
                <span className="admin-access"><span className={`admin-tier ${user.premium.tier}`}>{user.premium.tier === 'premium' ? 'Premium' : 'Free'}</span><small>{user.suspendedAt ? 'Suspended' : 'Active'}</small></span>
              </button>)}
              <div className="admin-pagination"><button disabled={cursors.length === 1} onClick={() => setCursors(c => c.slice(0, -1))}>Previous</button><span>Page {cursors.length}</span><button disabled={!users.data?.nextCursor} onClick={() => setCursors(c => [...c, users.data!.nextCursor!])}>Next</button></div>
            </>}
          </section>
          {userId && <aside className="admin-detail" aria-label="User details"><button className="admin-close" onClick={() => selectUser(null)} aria-label="Close user details">Close ×</button>
            {detail.isPending ? <p role="status">Loading account…</p> : detail.error ? <p role="alert">{detail.error.message}</p> : detail.data && <UserDetail user={detail.data} onAction={setAction} />}
          </aside>}
        </div>
        {action && detail.data && <ConfirmChange key={`${detail.data.id}:${action.action}:${action.grantId ?? 'all'}`} user={detail.data} action={action} csrfToken={session.data.csrfToken} close={() => setAction(null)} done={() => { setAction(null); setNotice(`${actionNames[action.action]} completed. The change was recorded.`) }} />}
      </>}
    </main>
  </div>
}
function UserDetail({ user, onAction }: { user: AdminUserDetail; onAction: (action: ActionSelection) => void }) {
  const can = (action: AdminUserChange['action']) => user.availableActions.includes(action)
  return <>
    <h2>{user.displayName}</h2><p className="admin-muted">{user.email ?? 'No email address'}</p>
    <section aria-label="Account status"><h3>Account</h3>
      <dl className="admin-facts"><div><dt>Status</dt><dd>{user.suspendedAt ? 'Suspended' : 'Active'}{user.isGuest ? ' · Guest' : ''}</dd></div><div><dt>Joined</dt><dd>{dates(user.createdAt)}</dd></div></dl>
      <div className="admin-actions">{can('suspend') && <button onClick={() => onAction({ action: 'suspend' })}>Suspend account</button>}{can('reactivate') && <button onClick={() => onAction({ action: 'reactivate' })}>Reactivate account</button>}</div>
    </section>
    <section aria-label="Premium access"><h3>Premium access</h3>
      <dl className="admin-facts"><div><dt>Current tier</dt><dd>{user.premium.tier === 'premium' ? user.premium.source === 'stripe' ? 'Premium · Stripe' : user.premium.source === 'grant_and_stripe' ? 'Premium · Stripe + complimentary' : 'Premium · complimentary' : 'Free'}</dd></div>{user.premium.expiresAt && <div><dt>Effective expiry</dt><dd>{dates(user.premium.expiresAt)}</dd></div>}</dl>
      {user.suspendedAt && <p className="admin-notice">Account suspension blocks access, even if a Premium grant is active.</p>}
      <p className="admin-muted">Live is disabled for everyone until usage limits are set. Paid access and complimentary grants are evaluated separately.</p>
      <div className="admin-actions">{can('grant_premium') && <button onClick={() => onAction({ action: 'grant_premium' })}>Grant Premium</button>}{can('revoke_premium') && <button onClick={() => onAction({ action: 'revoke_premium' })}>Revoke all complimentary grants</button>}</div>
      <h4>Grant history</h4>
      {user.grants.length ? <ul className="admin-grants">{user.grants.map(grant => <li key={grant.id}>
        <div className="admin-grant-title"><strong>{grant.status === 'scheduled' ? 'Scheduled' : grant.status === 'active' ? 'Active' : grant.status === 'revoked' ? 'Revoked' : 'Expired'}</strong>
          {can('revoke_premium') && (grant.status === 'active' || grant.status === 'scheduled') && <button onClick={() => onAction({ action: 'revoke_premium', grantId: grant.id })} aria-label={`Revoke grant: ${grant.reason}`}>Revoke this grant</button>}</div>
        <p>{grant.reason}</p><small>Starts {dates(grant.startsAt)}<br />Expires {dates(grant.expiresAt)}{grant.revokedAt && <><br />Revoked {dates(grant.revokedAt)}</>}</small>
      </li>)}</ul> : <p className="admin-muted">No complimentary grants.</p>}
      {user.grantCount > user.grants.length && <p className="admin-muted">Showing the latest {user.grants.length} of {user.grantCount} grants. Previews include all grants.</p>}
    </section>
    <AdminUserBilling user={user} />
    <section><h3>Workspaces <span>{user.memberships.length}</span></h3>{user.memberships.length ? <ul className="admin-memberships">{user.memberships.map(m => <li key={m.id}><strong>{m.workspace.name}</strong><small>{m.role} · {m.status}</small></li>)}</ul> : <p className="admin-muted">No workspace memberships.</p>}</section>
    <section><h3>Recent account changes</h3>{user.activity.length ? <ol className="admin-activity">{user.activity.map(event => <li key={event.id}><strong>{actionNames[event.action as AdminUserChange['action']] ?? event.action}</strong><p>{event.reason}</p><small>{dates(event.createdAt)}</small></li>)}</ol> : <p className="admin-muted">No admin changes recorded.</p>}</section>
  </>
}
function ConfirmChange({ user: initialUser, action: selection, csrfToken, close, done }: { user: AdminUserDetail; action: ActionSelection; csrfToken: string | null; close: () => void; done: () => void }) {
  const [user] = useState(initialUser)
  const { action, grantId } = selection
  const dialog = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')
  const [expiry, setExpiry] = useState('')
  const mutation = useAdminUserChange(csrfToken)
  const validExpiry = expiry && Number.isFinite(new Date(expiry).getTime()) ? new Date(expiry).toISOString() : undefined
  const input = action !== 'grant_premium' || validExpiry ? { action, grantId, expectedVersion: user.version, ...(action === 'grant_premium' ? { expiresAt: validExpiry } : {}) } : null
  const preview = useAdminChangePreview(user.id, input, csrfToken)
  const title = action === 'revoke_premium' ? grantId ? 'Revoke this grant' : 'Revoke all complimentary grants' : actionNames[action]
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close() }, [])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (mutation.isPending || !input || !preview.data || preview.isFetching || preview.error) return
    mutation.mutate({ userId: user.id, ...input, reason: reason.trim(), confirmed: true }, { onSuccess: done })
  }
  const accessLabel = (state: { account: string; tier: string; expiresAt: string | null }) => `${state.account === 'suspended' ? 'Suspended · ' : ''}${state.tier === 'premium' ? `Premium until ${dates(state.expiresAt)}` : 'Free'}`
  return <dialog className="admin-confirm" ref={dialog} aria-labelledby="admin-confirm-title" onCancel={event => { event.preventDefault(); if (!mutation.isPending) close() }}>
    <form onSubmit={submit}><h2 id="admin-confirm-title">{title}?</h2><p>Account: <strong>{user.displayName}</strong><br />{user.email ?? user.id}</p>
      {action === 'grant_premium' && <label>Premium expires (your local time)<input type="datetime-local" required value={expiry} onChange={event => setExpiry(event.target.value)} /></label>}
      {action === 'suspend' && <p>This ends login sessions and blocks access across workspaces. It does not cancel billing.</p>}
      {action === 'reactivate' && <p>Workspace roles and membership suspensions stay in place. Expired Premium is not restored.</p>}
      {action === 'revoke_premium' && <p>{grantId ? 'Only the selected complimentary grant will be revoked.' : 'All active and scheduled complimentary grants will be revoked.'} This does not cancel a paid subscription.</p>}
      {!input ? <p className="admin-muted">Choose an expiry to preview the result.</p> : preview.isFetching ? <p role="status">Calculating access…</p> : preview.error ? <p role="alert" className="admin-error">{preview.error.message}</p> : preview.data && <section className="admin-impact" aria-label="Change preview">
        <dl><dt>Before</dt><dd>{accessLabel(preview.data.before)}</dd><dt>After confirmation</dt><dd>{accessLabel(preview.data.after)}</dd></dl>
        {action === 'grant_premium' && preview.data.before.tier === 'premium' && preview.data.before.expiresAt === preview.data.after.expiresAt && <p>A later expiry already applies. This grant will not extend current access.</p>}
        {action === 'revoke_premium' && <p>{preview.data.affectedGrantCount} grant(s) affected.{preview.data.after.tier === 'premium' && ' Another grant or paid subscription keeps Premium active.'}</p>}
        <p>{preview.data.billingImpact}</p><p>{preview.data.liveImpact}</p><small>Effective immediately after confirmation. Scheduled grants may change access later.</small>
      </section>}
      <label>Reason<textarea autoFocus required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Why is this change needed?" /></label>
      <p className="admin-muted">Your confirmation and this reason will be recorded.</p>
      {mutation.error && <p role="alert" className="admin-error">{mutation.error.message}</p>}
      <footer><button type="button" disabled={mutation.isPending} onClick={close}>Cancel</button><button type="submit" className="admin-primary" disabled={mutation.isPending || reason.trim().length < 3 || !preview.data || preview.isFetching || !!preview.error}>{mutation.isPending ? 'Saving…' : `Confirm ${action === 'suspend' ? 'suspension' : action === 'reactivate' ? 'reactivation' : action === 'grant_premium' ? 'grant' : 'revocation'}`}</button></footer>
    </form>
  </dialog>
}
