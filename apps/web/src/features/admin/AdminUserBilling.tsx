import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminSession, useAdminCustomerLink, type AdminUserDetail } from '@project/sdk'

export function AdminUserBilling({user}:{user:AdminUserDetail}) {
  const session=useAdminSession()
  const [linking,setLinking]=useState(false)
  return <section aria-label="Billing status"><h3>Billing</h3>
    <p className="admin-muted">Complimentary grants do not create charges. Suspending an account does not stop an existing subscription.</p>
    {user.billing?.customerId ? <><p>Linked customer: {user.billing.customerId} · {user.billing.mode}</p><ul className="admin-grants">{user.billing.subscriptions.map(s=><li key={s.id}><strong>{s.status.replaceAll('_',' ')}</strong><p>{s.id}</p><small>Latest invoice: {s.invoiceStatus ?? 'Unknown'}<br/>Paid access ends: {s.accessUntil ? new Date(s.accessUntil).toLocaleString() : 'No paid access'}<br/>Last synchronized: {new Date(s.syncedAt).toLocaleString()}</small></li>)}</ul>{!user.billing.subscriptions.length && <p className="admin-muted">No subscriptions synchronized. Reconcile the subscription in Billing.</p>}</> : <p className="admin-muted">No Stripe customer is linked to this account. Payment status is unknown.</p>}
    {!user.billingConfigured && <p className="admin-muted">Stripe is not configured.</p>}
    <div className="admin-actions"><Link to="/admin/billing">Open Billing →</Link>{session.data?.role==='platform_owner' && user.billingConfigured && !user.billing?.customerId && !user.isGuest && user.kind==='human' && <button onClick={()=>setLinking(true)}>Link Stripe customer</button>}</div>
    {linking && <LinkCustomer user={user} csrf={session.data?.csrfToken} close={()=>setLinking(false)} />}
  </section>
}
function LinkCustomer({user:initial,csrf,close}:{user:AdminUserDetail;csrf?:string|null;close:()=>void}) {
  const [user]=useState(initial)
  const ref=useRef<HTMLDialogElement>(null)
  const [customerId,setCustomerId]=useState('')
  const [reason,setReason]=useState('')
  const [confirm,setConfirm]=useState(false)
  const mutation=useAdminCustomerLink(csrf)
  useEffect(()=>{const el=ref.current!;el.showModal();return ()=>el.close()},[])
  return <dialog ref={ref} className="admin-confirm" aria-labelledby="customer-link-title" onCancel={e=>{if(mutation.isPending)e.preventDefault();else close()}}><h2 id="customer-link-title">Link Stripe customer</h2><p>Account: <strong>{user.displayName}</strong><br/>{user.email ?? user.id}</p><label>Stripe customer ID<input value={customerId} onChange={e=>{setCustomerId(e.target.value.trim());setConfirm(false)}} placeholder="cus_…" maxLength={191}/></label><p className="admin-muted">Before: no linked customer. After: this account owns the selected customer's synchronized Premium access. Verify the customer in Stripe first; links cannot be reassigned here. No charge, cancellation, or refund is created. Reconcile the subscription after linking.</p><label>Reason<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label><label className="admin-check"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>I verified this customer belongs to this user.</label>{mutation.error && <p role="alert">{mutation.error.message}</p>}<footer><button disabled={mutation.isPending} onClick={close}>Cancel</button><button disabled={mutation.isPending||!confirm||reason.trim().length<3||!/^cus_[A-Za-z0-9]+$/.test(customerId)} onClick={()=>mutation.mutate({userId:user.id,customerId,expectedVersion:user.version,reason,confirmed:true},{onSuccess:close})}>Confirm customer link</button></footer></dialog>
}
