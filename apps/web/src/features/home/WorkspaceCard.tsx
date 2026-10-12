import { Link } from 'react-router-dom'
import type { Workspace } from '@project/sdk'

export function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const initial = workspace.name.slice(0, 1).toUpperCase()
  const roleLabel = workspace.role === 'owner' ? 'Owner' : workspace.role === 'admin' ? 'Admin' : 'Member'
  const meta = [
    roleLabel.toUpperCase(),
    workspace.timezone ? workspace.timezone.replace('_', ' ') : null,
    workspace.defaultCurrency ? workspace.defaultCurrency.toUpperCase() : null,
  ].filter(Boolean)

  return (
    <div className="conv-card workspace-card" data-workspace-id={workspace.id}>
      <Link className="conv-card-link" to={`/c/${workspace.id}`}>
        <span className="conv-card-thumb workspace-card-thumb">
          <span className="workspace-thumb-mark" aria-hidden>{initial}</span>
          <span className="workspace-thumb-role">{roleLabel}</span>
        </span>
        <span className="conv-card-title">{workspace.name}</span>
        <span className="conv-card-desc">
          Company workspace · {workspace.role === 'owner' ? 'Owner' : `${roleLabel} access`}
        </span>
      </Link>
      <span className="conv-card-meta">
        <span>{meta.join(' · ')}</span>
      </span>
    </div>
  )
}

export function WorkspaceCreateCard() {
  return (
    <div className="conv-card workspace-card workspace-card-create">
      <Link className="conv-card-link workspace-create-link" to="/workspaces/new">
        <span className="conv-card-thumb workspace-card-thumb workspace-create-thumb">
          <span className="workspace-create-icon" aria-hidden>+</span>
        </span>
        <span className="conv-card-title">Create a workspace</span>
        <span className="conv-card-desc">
          Set up a new workspace for your company, records, and team.
        </span>
      </Link>
      <span className="conv-card-meta">
        <span>NEW WORKSPACE</span>
      </span>
    </div>
  )
}
