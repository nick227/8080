import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useStaffMfa, useStaffMfaEnroll, useStaffMfaVerify } from '@project/sdk'
import './admin.css'

export function AdminMfaBoundary() {
  const status=useStaffMfa(),client=useQueryClient()
  const enroll=useStaffMfaEnroll(status.data?.csrfToken),verify=useStaffMfaVerify(status.data?.csrfToken)
  const [password,setPassword]=useState(''),[code,setCode]=useState(''),[secret,setSecret]=useState<string|null>(null),[recovery,setRecovery]=useState<string[]>([])
  const verified=!!status.data?.verifiedUntil && new Date(status.data.verifiedUntil)>new Date()
  async function finish(){setRecovery([]);setSecret(null);setCode('');enroll.reset();verify.reset();await client.invalidateQueries({queryKey:['admin']});await status.refetch()}
  if(verified && !recovery.length)return <Outlet/>
  return <main className="admin-app" style={{display:'block'}}><div className="admin-main" style={{maxWidth:560,margin:'0 auto'}}><h1>Staff verification</h1>
    {status.isPending?<p role="status">Checking staff session…</p>:status.error?<><p role="alert">{status.error.message}</p><Link to="/account">Go to account</Link></>:recovery.length?<>
      <h2>Save your recovery codes</h2><p>Each code works once if you lose your authenticator. Store these somewhere private. They will not be shown again.</p><ul>{recovery.map(value=><li key={value}><code>{value}</code></li>)}</ul><button onClick={()=>void finish()}>I saved these codes</button>
    </>:<>
      <p>{status.data?.enrolled?'Enter an authenticator code or an unused recovery code. Verification unlocks this login session for 15 minutes.':'Set up an authenticator before using platform administration. Enter your account password to begin.'}</p>
      {!status.data?.enrolled && !secret?<form onSubmit={e=>{e.preventDefault();enroll.mutate(password,{onSuccess:r=>{setPassword('');setSecret(r.secret)}})}}><label className="admin-search">Current password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={128}/></label><button disabled={enroll.isPending||!password}>Set up authenticator</button></form>:<>
        {secret && <><p>Add an account to your authenticator using this setup key (time-based, six digits):</p><p style={{overflowWrap:'anywhere'}}><code>{secret}</code></p></>}
        <form onSubmit={e=>{e.preventDefault();verify.mutate(code.trim(),{onSuccess:r=>{setCode('');setSecret(null);if(r.recoveryCodes.length)setRecovery(r.recoveryCodes);else void finish()}})}}><label className="admin-search">Authenticator or recovery code<input autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} required maxLength={32}/></label><button disabled={verify.isPending||!code}>Verify staff access</button></form>
      </>}
      {(enroll.error||verify.error)&&<p role="alert">{(enroll.error??verify.error)?.message}</p>}
      <p className="admin-muted">Platform authority, Premium, and workspace access remain separate. For enrollment or recovery help, contact the platform operator.</p>
    </>}
  </div></main>
}
