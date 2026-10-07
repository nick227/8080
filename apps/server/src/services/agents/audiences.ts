// Recipient sources an Agent type may use (docs/agents/04 "Recipient resolution",
// 06 §4). Resolved at execution time, never stored as id lists on the Agent.
import { db, type Workspace } from '@project/db'
import type { MergeValues } from '@project/shared'
import type { EmailRecipient } from './registry'

/** Values every message can use: company.* (profile, else workspace) and workspace.*. */
export async function baseValues(workspace: Workspace): Promise<MergeValues> {
  const profile = await db.companyProfile.findUnique({ where: { workspaceId: workspace.id }, select: { name: true } })
  return {
    'company.name': profile?.name?.trim() || workspace.name,
    'company.website': null,
    'company.googleReviewUrl': null,
    'workspace.name': workspace.name,
  }
}

/** Team audience: every active member; their account email is the address. */
export async function workspaceMembers(workspace: Workspace, base: MergeValues): Promise<EmailRecipient[]> {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId: workspace.id, status: 'active' },
    include: { user: { select: { email: true, profile: { select: { displayName: true } } } } },
    orderBy: { joinedAt: 'asc' },
  })
  return members.map((m) => {
    const displayName = m.user.profile?.displayName?.trim() || m.user.email || 'Team member'
    return {
      address: m.user.email,
      label: displayName,
      memberId: m.id,
      values: { ...base, 'member.displayName': displayName, 'member.firstName': displayName.split(/\s+/)[0] },
    }
  })
}
