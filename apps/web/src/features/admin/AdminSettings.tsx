import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminSession, useAdminSettings, useAdminUsers, useAdminStaffChange, type AdminUser } from '@project/sdk'
import { SEO } from '../../components/SEO'
import './admin.css'

export function AdminSettings() {
  const session = useAdminSession()
  const settings = useAdminSettings(!!session.data)
  const [query, setQuery] = useState('')
  const users = useAdminUsers(query, undefined, !!settings.data?.canManage && query.trim().length > 1)
  const [target, setTarget] = useState<Pick<AdminUser,'id'|'displayName'|'staffRole'|'version'> | null>(null)
  const [notice, setNotice] = useState('')
  return <div className="admin-app">
    <SEO title="Settings · 8080 Admin" description="Platform staff and billing readiness" />
    <aside className="admin-sidebar"><Link className="admin-brand" to="/">8080 <span>Admin</span></Link><nav aria-label="Administration"><Link to="/admin">Users</Link><Link to="/admin/blueprints">Blueprints</Link><Link to="/admin/billing">Billing</Link><Link to="/admin/settings" aria-current="page">Settings</Link></nav><Link className="admin-return" to="/account">← Back to account</Link></aside>
    <main className="admin-main"><header className="admin-heading"><div><p>Platform authority</p><h1>Settings</h1></div><span>Staff and launch controls</span></header>
      {session.error || settings.error ? <p role="alert">{(session.error ?? settings.error)?.message}</p> : !settings.data ? <p role="status">Loading settings…</p> : <>
        {notice && <p className="admin-notice" role="status">{notice}</p>}
        <section className="admin-settings-section"><h2>Platform staff</h2><p className="admin-muted">Platform roles do not grant workspace membership or Premium. Owners manage staff and billing links; admins manage users and view billing.</p>
          {!settings.data.canManage && <p className="admin-muted">Only platform owners can change staff roles.</p>}
          <ul className="admin-grants">{settings.data.staff.map(s => <li key={s.userId}><div className="admin-grant-title"><div><strong>{s.displayName}</strong><p>{s.email ?? s.userId}</p><small>{s.role.replaceAll('_',' ')}{s.suspended ? ' · suspended' : ''}</small></div>{settings.data!.canManage && <button onClick={() => setTarget({id:s.userId,displayName:s.displayName,staffRole:s.role,version:s.version})}>Change role</button>}</div></li>)}</ul>
          {settings.data.canManage && <><label className="admin-search">Find a registered user to appoint<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, email, or user ID" /></label>{query.trim().length > 1 && <div className="admin-list">{users.error ? <p role="alert">{users.error.message}</p> : users.isFetching ? <p role="status">Searching…</p> : users.data?.data.filter(u=>!u.isGuest && u.kind==='human' && !u.suspendedAt).map(u=><button className="admin-user-row" key={u.id} onClick={()=>setTarget(u)}><span><strong>{u.displayName}</strong><small>{u.email ?? u.id}</small></span><span>{u.staffRole ?? 'No staff role'}</span></button>)}</div>}</>}
        </section>
        <section className="admin-settings-section"><h2>Billing readiness</h2><dl className="admin-facts"><div><dt>Stripe mode</dt><dd>{settings.data.billing.mode ?? 'Not configured'}</dd></div><div><dt>Subscription synchronization</dt><dd>{settings.data.billing.configured ? 'Configured' : 'Setup incomplete'}</dd></div><div><dt>Premium prices configured</dt><dd>{settings.data.billing.premiumPriceCount}</dd></div><div><dt>Signed events</dt><dd>{settings.data.billing.webhookConfigured ? 'Configured' : 'Not configured'}</dd></div><div><dt>Last processed event</dt><dd>{settings.data.billing.lastEventAt ? new Date(settings.data.billing.lastEventAt).toLocaleString() : 'None received'}</dd></div></dl><p className="admin-muted">Configuration is not proof of a successful connection. Paid access requires an explicitly linked customer, a configured Premium price, an active subscription, and a paid invoice. Trials and overdue subscriptions do not unlock Premium.</p><Link to="/admin/billing">Open Billing →</Link></section>
        <section className="admin-settings-section"><h2>Premium availability</h2><p>{settings.data.live.reason}</p><p className="admin-muted">{settings.data.checkout.reason} No control here can enable Live or create charges.</p></section>
      </>}
    </main>
    {target && <StaffDialog target={target} csrfToken={session.data?.csrfToken} onClose={()=>setTarget(null)} onSaved={()=>{setTarget(null);setNotice('Staff role updated and recorded.')}} />}
  </div>
}
function StaffDialog({target,csrfToken,onClose,onSaved}:{target:Pick<AdminUser,'id'|'displayName'|'staffRole'|'version'>;csrfToken?:string|null;onClose:()=>void;onSaved:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null)
  const [role,setRole]=useState(target.staffRole ?? 'platform_admin')
  const [reason,setReason]=useState('')
  const change=useAdminStaffChange(csrfToken)
  useEffect(()=>{dialog.current?.showModal()},[])
  return <dialog className="admin-confirm" ref={dialog} onCancel={e=>{if(change.isPending)e.preventDefault();else onClose()}}><h2>Change staff role</h2><p>{target.displayName}</p><p>Before: {target.staffRole ?? 'No staff access'}</p><label>After<select value={role} onChange={e=>setRole(e.target.value as typeof role)}><option value="platform_admin">Platform admin</option><option value="platform_owner">Platform owner</option><option value="">No staff access</option></select></label><p className="admin-muted">Owners can appoint other staff and link billing customers. Removing staff access does not cancel Premium or remove workspace roles. You cannot change your own role.</p><label>Reason<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>{change.error && <p role="alert">{change.error.message}</p>}<footer><button disabled={change.isPending} onClick={onClose}>Cancel</button><button disabled={change.isPending || reason.trim().length<3 || (role||null)===target.staffRole} onClick={()=>change.mutate({userId:target.id,expectedVersion:target.version,role:role||null,reason,confirmed:true},{onSuccess:onSaved})}>Confirm role change</button></footer></dialog>
}
