import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminSession, useAdminSubscriptions, useAdminSubscriptionSync } from '@project/sdk'
import { SEO } from '../../components/SEO'
import './admin.css'

export function AdminBilling() {
  const session = useAdminSession()
  const [syncId, setSyncId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState('all')
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const billing = useAdminSubscriptions(status, cursors[cursors.length - 1], !!session.data)
  return <div className="admin-app">
    <SEO title="Billing · 8080 Admin" description="Read-only subscription billing" />
    <aside className="admin-sidebar"><Link className="admin-brand" to="/">8080 <span>Admin</span></Link><nav aria-label="Administration"><Link to="/admin">Users</Link><Link to="/admin/blueprints">Blueprints</Link><Link to="/admin/billing" aria-current="page">Billing</Link><Link to="/admin/settings">Settings</Link></nav><Link className="admin-return" to="/account">← Back to account</Link></aside>
    <main className="admin-main"><header className="admin-heading"><div><p>Stripe · Read only</p><h1>Billing</h1></div><span>Subscriptions and latest invoice status</span></header>
      {session.isPending ? <p role="status">Checking staff access…</p> : session.error ? <p role="alert">{session.error.message}</p> : <>
        <p className="admin-muted">Only verified, linked Premium subscriptions grant paid access. Cancel subscriptions, issue refunds, or change prices in Stripe.</p>
        {notice && <p className="admin-notice" role="status">{notice}</p>}<div className="admin-billing-controls"><label>Status <select aria-label="Subscription status" value={status} onChange={e => { setStatus(e.target.value); setCursors([undefined]) }}>{['all','active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'].map(s => <option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select></label><button disabled={billing.isFetching} onClick={() => void billing.refetch()}>Refresh</button></div>
        {billing.isPending ? <p role="status">Loading billing…</p> : billing.error ? <div role="alert"><h2>Billing unavailable</h2><p>{billing.error.message}</p><p>No billing or access changes were made.</p></div> : !billing.data?.configured ? <section className="admin-empty"><h2>Stripe is not connected</h2><p>Connect a restricted Stripe key with read access to subscriptions and invoices to view billing here.</p><p>Complimentary grants remain available in Users. Payment status is unknown until Stripe is connected.</p></section> : <>
          <p className="admin-muted"><strong>{billing.data.mode === 'test' ? 'Stripe test mode — not real charges' : 'Stripe live mode'}</strong> · Retrieved {billing.data.fetchedAt ? new Date(billing.data.fetchedAt).toLocaleString() : '—'}</p>
          <div className="admin-billing-table"><table><thead><tr><th>User / customer</th><th>Subscription</th><th>Latest invoice</th><th>Interval</th><th>Billing date</th><th>Record</th></tr></thead><tbody>{billing.data.data.map(sub => <tr key={sub.id}>
            <td>{sub.user ? <><Link to={`/admin?user=${encodeURIComponent(sub.user.id)}`}>{sub.user.displayName}</Link><small>{sub.linkVerified ? 'Verified customer link' : 'Metadata hint only — not linked'}</small></> : <><strong>Unlinked user</strong><small>{sub.customerId ?? 'Customer unavailable'}</small></>}</td>
            <td>{sub.status.replaceAll('_',' ')}<small>{sub.id}</small></td><td>{sub.invoiceStatus?.replaceAll('_',' ') ?? 'Unknown / no invoice'}</td><td>{sub.interval}</td><td>{sub.dateLabel}<small>{sub.date ? new Date(sub.date).toLocaleString() : '—'}</small></td><td><a href={sub.dashboardUrl} target="_blank" rel="noreferrer">Open Stripe ↗</a>{session.data?.role === 'platform_owner' && <button className="admin-sync-button" onClick={()=>setSyncId(sub.id)}>Reconcile access</button>}</td>
          </tr>)}</tbody></table></div>
          {!billing.data.data.length && <p className="admin-empty">No subscriptions match this filter.</p>}
          <p className="admin-muted">Period-end dates are not a promise that a payment will succeed. Mixed-interval subscriptions show the earliest item period end; see Stripe for the full schedule.</p>
          <div className="admin-pagination"><button disabled={cursors.length === 1 || billing.isFetching} onClick={() => setCursors(c => c.slice(0,-1))}>Previous</button><span>Page {cursors.length}</span><button disabled={!billing.data.nextCursor || billing.isFetching} onClick={() => setCursors(c => [...c, billing.data!.nextCursor!])}>Next</button></div>
        </>}
      </>}
    </main>
    {syncId && <SyncDialog id={syncId} csrf={session.data?.csrfToken} close={()=>setSyncId(null)} saved={()=>{setSyncId(null);setNotice('Subscription synchronized and recorded. App access now reflects the verified billing state.')}} />}
  </div>
}

function SyncDialog({id,csrf,close,saved}:{id:string;csrf?:string|null;close:()=>void;saved:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null)
  const [reason,setReason]=useState('')
  const mutation=useAdminSubscriptionSync(csrf)
  useEffect(()=>{const el=ref.current!;el.showModal();return ()=>el.close()},[])
  return <dialog ref={ref} className="admin-confirm" aria-labelledby="sync-title" onCancel={e=>{if(mutation.isPending)e.preventDefault();else close()}}><h2 id="sync-title">Reconcile subscription access</h2><p>{id}</p><p>This reads the latest Stripe state and updates local paid access. It can grant or remove Premium for the explicitly linked user. Complimentary grants remain in place. Live remains disabled.</p><p className="admin-muted">No charge, refund, price change, or subscription cancellation is sent to Stripe.</p><label>Reason<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>{mutation.error && <p role="alert">{mutation.error.message}</p>}<footer><button disabled={mutation.isPending} onClick={close}>Cancel</button><button disabled={mutation.isPending||reason.trim().length<3} onClick={()=>mutation.mutate({subscriptionId:id,reason,confirmed:true},{onSuccess:saved})}>Confirm reconciliation</button></footer></dialog>
}
