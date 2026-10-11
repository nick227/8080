import { Link } from 'react-router-dom'
import { useMyWorkspaces, useSession } from '@project/sdk'
import { rememberedWorkspace } from '../../app/workspace'
import { useShell } from '../../state/shell'

export function WorkspaceList({ compact = false }: { compact?: boolean }) {
  const session = useSession()
  const user = session.data?.data
  if (session.isError) return <p role="alert">Could not load your account. <button type="button" onClick={() => void session.refetch()}>Retry</button></p>
  if (!user) return <p role="status">Loading your account…</p>
  if (user.isGuest) return compact ? null : <div className="product-empty"><p>Sign in to see the workspaces you belong to.</p><button className="product-button" onClick={() => useShell.getState().toggleAccount()}>Sign in</button><Link to="/workspaces/new">Create a workspace</Link></div>
  return <Memberships compact={compact} />
}

function Memberships({ compact }: { compact: boolean }) {
  const query = useMyWorkspaces()
  const remembered = rememberedWorkspace()
  const list = [...(query.data ?? [])].sort((a, b) => a.id === remembered ? -1 : b.id === remembered ? 1 : a.name.localeCompare(b.name))
  return <section className="product-memberships" aria-label="Your workspaces">
    {compact && <div className="product-section-heading"><h2>Your workspaces</h2><Link to="/workspaces">All workspaces →</Link></div>}
    {query.isLoading ? <p role="status">Loading workspaces…</p> : query.isError ? <p role="alert">Could not load workspaces. <button type="button" onClick={() => void query.refetch()}>Retry</button></p> : list.length === 0 ? <div className="product-empty"><p>You do not belong to a workspace yet.</p><p>Create a workspace to add your company's contacts, inventory, and documents, and invite team members.</p><p>If your team invited you, open their invitation link.</p></div> : <ul className="product-workspaces">{(compact ? list.slice(0, 3) : list).map((workspace) => <li key={workspace.id}><Link to={`/c/${workspace.id}`}><span className="product-company-mark" aria-hidden>{workspace.name.slice(0, 1).toUpperCase()}</span><span><strong>{workspace.name}</strong><small>{workspace.role === 'owner' ? 'Owner' : workspace.role === 'admin' ? 'Admin' : 'Member'}</small></span><span aria-hidden>→</span></Link></li>)}</ul>}
    <Link className="product-text-action" to="/workspaces/new">Create a workspace</Link>
  </section>
}
