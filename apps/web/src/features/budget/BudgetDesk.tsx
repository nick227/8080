import { useCurrentWorkspace } from '../documents/workspace'
import { BudgetTable } from './BudgetTable'

export function BudgetDesk() {
  const { workspace, loading } = useCurrentWorkspace()

  if (loading) {
    return (
      <p className="record-loading" role="status">
        Loading budget…
      </p>
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
