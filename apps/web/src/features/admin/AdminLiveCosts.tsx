import { useEffect, useRef, useState } from 'react'
import { useAdminLiveCosts, useAdminLiveStop } from '@project/sdk'

export function AdminLiveCosts({canManage,csrf}:{canManage:boolean;csrf?:string|null}) {
  const status=useAdminLiveCosts()
  const [version,setVersion]=useState<number|null>(null)
  return <section className="admin-settings-section"><h2>Live spending control</h2>
    <p className="admin-muted">One personal allowance across all workspaces, with a separate platform ceiling. Live admission remains disabled.</p>
    {status.isPending ? <p role="status">Loading spending control…</p> : status.error ? <p role="alert">{status.error.message}</p> : status.data && <>
      <dl className="admin-facts"><div><dt>New spending</dt><dd>{status.data.stopped ? 'Stopped' : 'Budget checks active'}</dd></div><div><dt>Unresolved expired reservations</dt><dd>{status.data.unknownReservations}</dd></div></dl>
      <p className="admin-muted">{status.data.stopped ? status.data.reason : 'Reservations remain subject to both personal and platform limits.'}</p>
      <p className="admin-muted">A stop blocks new reservations and dispatches. It does not disconnect existing provider sessions or erase unresolved costs. No resume control is available while Live limits are undecided.</p>
      {canManage && <button disabled={status.data.stopped} onClick={()=>setVersion(status.data!.version)}>Stop new Live spending</button>}
    </>}
    {version!==null && <StopDialog version={version} csrf={csrf} close={()=>setVersion(null)}/>}
  </section>
}
function StopDialog({version,csrf,close}:{version:number;csrf?:string|null;close:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null)
  const [reason,setReason]=useState('')
  const stop=useAdminLiveStop(csrf)
  useEffect(()=>{const el=ref.current!;el.showModal();return ()=>el.close()},[])
  return <dialog className="admin-confirm" ref={ref} aria-labelledby="live-stop-title" onCancel={e=>{if(stop.isPending)e.preventDefault();else close()}}><h2 id="live-stop-title">Stop new Live spending</h2><p>Before: budget checks active. After: new reservations and dispatches blocked platform-wide.</p><p>Existing liabilities remain reserved. This does not confirm that existing LiveKit sessions have stopped.</p><label>Reason<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>{stop.error && <p role="alert">{stop.error.message}</p>}<footer><button disabled={stop.isPending} onClick={close}>Cancel</button><button disabled={stop.isPending||reason.trim().length<3} onClick={()=>stop.mutate({expectedVersion:version,reason,confirmed:true},{onSuccess:close})}>Confirm spending stop</button></footer></dialog>
}
