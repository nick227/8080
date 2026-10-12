import { WorkspaceLoading } from '../work/WorkspaceTransition'
import { useCurrentWorkspace } from '../documents/workspace'
import { BudgetTable } from './BudgetTable'

export function BudgetDesk() {
  const { workspace, loading } = useCurrentWorkspace()

  if (loading) {
    return (
      <WorkspaceLoading label="Loading budget…" />
    )
  }

  if (!workspace) {
    return (
      <div className="budget-empty" role="alert">
        <p>No workspace selected.</p>
      </div>
    )
  }

  return <BudgetTable workspaceId={workspace.id} />
}
