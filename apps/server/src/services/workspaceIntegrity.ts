// Same-workspace rule (doc/09 §1, D13): single-column FKs can't stop a row in one
// workspace pointing at a row in another, so services only load related rows
// with `workspaceId` in the where-clause, and this check proves it held. Run by
// the invariant test; each domain adds its pairs here when it lands.
import { db } from '@project/db'

const CHECKS: { name: string; sql: string }[] = [
  {
    name: 'TeamMember.team',
    sql: 'SELECT tm.id FROM TeamMember tm JOIN Team t ON t.id = tm.teamId WHERE t.workspaceId <> tm.workspaceId',
  },
  {
    name: 'TeamMember.member',
    sql: 'SELECT tm.id FROM TeamMember tm JOIN WorkspaceMember m ON m.id = tm.memberId WHERE m.workspaceId <> tm.workspaceId',
  },
  {
    name: 'WorkspaceInvite.invitedBy',
    sql: 'SELECT i.id FROM WorkspaceInvite i JOIN WorkspaceMember m ON m.id = i.invitedById WHERE m.workspaceId <> i.workspaceId',
  },
  {
    name: 'ActionExecution.actorMember',
    sql: 'SELECT a.id FROM ActionExecution a JOIN WorkspaceMember m ON m.id = a.actorMemberId WHERE m.workspaceId <> a.workspaceId',
  },
  {
    name: 'Activity.actorMember',
    sql: 'SELECT a.id FROM Activity a JOIN WorkspaceMember m ON m.id = a.actorMemberId WHERE m.workspaceId <> a.workspaceId',
  },
  {
    name: 'Activity.actionExecution',
    sql: 'SELECT a.id FROM Activity a JOIN ActionExecution e ON e.id = a.actionExecutionId WHERE e.workspaceId <> a.workspaceId',
  },
  {
    name: 'ActivitySubject.activity',
    sql: 'SELECT s.id FROM ActivitySubject s JOIN Activity a ON a.id = s.activityId WHERE a.workspaceId <> s.workspaceId',
  },
]

/** Rows whose references cross a workspace boundary, by check name. Empty = sound. */
export async function crossWorkspaceViolations() {
  const found: Record<string, string[]> = {}
  for (const check of CHECKS) {
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(check.sql)
    if (rows.length) found[check.name] = rows.map((r) => r.id)
  }
  return found
}
