import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCreateWorkspace, useSession } from '@project/sdk'
import { WorkspaceList } from '../features/home/WorkspaceList'
import { GuestAuth } from '../features/AccountSheet'
import { SEO } from '../components/SEO'
import { chooseWorkspace } from '../app/workspace'

export function Workspaces() {
  return <div className="app-page"><SEO title="Your workspaces — 8080" /><div className="product-page-heading"><h1>Your workspaces</h1></div><WorkspaceList /></div>
}

export function NewWorkspace() {
  const session = useSession()
  const user = session.data?.data
  const create = useCreateWorkspace()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const submitting = useRef(false)
  useEffect(() => {
    try {
      if (user && !user.isGuest) sessionStorage.removeItem('8080.create-workspace')
    } catch { /* Account authentication does not require browser storage. */ }
  }, [user])
  return <div className="app-page"><SEO title="Create a workspace — 8080" /><div className="product-create"><Link to="/workspaces">← Workspaces</Link><h1>Create a workspace</h1>
    {session.isError ? <p role="alert">Could not load your account. <button onClick={() => void session.refetch()}>Retry</button></p> : !user ? <p role="status">Loading your account…</p> : user.isGuest ? <><p>Sign in or create an account to create a workspace. You will enter your company name next.</p><GuestAuth user={user} onExternalSignIn={() => sessionStorage.setItem('8080.create-workspace', '1')} /></> : <form onSubmit={async (event) => {
      event.preventDefault()
      if (!name.trim() || submitting.current) return
      submitting.current = true
      try {
        const workspace = await create.mutateAsync({ name: name.trim() })
        chooseWorkspace(workspace.id)
        navigate(`/c/${workspace.id}`)
      } catch { /* Mutation error is displayed below; keep the entered name. */ }
      finally { submitting.current = false }
    }}><p>This workspace will contain your company's records, documents, and team members.</p><label htmlFor="company-name">Company name</label><input id="company-name" name="company" autoComplete="organization" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoFocus disabled={create.isPending} />{create.isError && <p role="alert">{create.error instanceof Error ? create.error.message : 'Could not create workspace. Please try again.'}</p>}<div className="product-actions"><button className="product-button" type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? 'Creating workspace…' : 'Create workspace'}</button><Link to="/workspaces">Cancel</Link></div></form>}
  </div></div>
}
