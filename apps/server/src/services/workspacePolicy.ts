// The one place workspace permissions are decided (doc/09 §8, D4). Every
// workspace-scoped service call starts with authorize(); handlers never look at
// roles. V1 is deliberately broad: active members read everything, owners/admins
// manage. Record-level rules (ownerMemberId, teamId) arrive with the domains and
// are decided here too — no ACL tables yet.
import { db, type Workspace, type WorkspaceMember, type WorkspaceRole } from '@project/db'
import { forbidden, httpError, notFound } from '../lib/errors'

export type WorkspaceVerb =
  | 'workspace.read'
  | 'workspace.update'
  | 'workspace.delete'
  | 'member.read'
  | 'member.invite'
  | 'member.manage'
  | 'team.read'
  | 'team.manage'
  | 'team.members.manage'
  | 'activity.read'
  | 'audit.read'

const OWNERS: readonly WorkspaceRole[] = ['owner']
const ADMINS: readonly WorkspaceRole[] = ['owner', 'admin']
const EVERYONE: readonly WorkspaceRole[] = ['owner', 'admin', 'member']

const ROLES: Record<WorkspaceVerb, readonly WorkspaceRole[]> = {
  'workspace.read': EVERYONE,
  'workspace.update': ADMINS,
  'workspace.delete': OWNERS,
  'member.read': EVERYONE,
  'member.invite': ADMINS,
  'member.manage': ADMINS,
  'team.read': EVERYONE,
  'team.manage': ADMINS,
  'team.members.manage': ADMINS, // + the team's own leads (below)
  'activity.read': EVERYONE,
  'audit.read': ADMINS,
}

// What a verb is applied to, when the answer depends on it.
export type PolicyTarget =
  // `role`: the member being changed; `grant`: the role being given to them.
  | { kind: 'member'; role: WorkspaceRole; grant?: WorkspaceRole }
  | { kind: 'team'; leadMemberIds: readonly string[] }

export type Actor = { member: WorkspaceMember; workspace: Workspace }

export function can(member: Pick<WorkspaceMember, 'id' | 'role' | 'status'>, verb: WorkspaceVerb, target?: PolicyTarget): boolean {
  if (member.status !== 'active') return false
  if (verb === 'team.members.manage' && target?.kind === 'team' && target.leadMemberIds.includes(member.id)) return true
  if (!ROLES[verb].includes(member.role)) return false
  // Only owners touch owners, or make someone an owner.
  if (verb === 'member.manage' && target?.kind === 'member' && member.role !== 'owner') {
    if (target.role === 'owner' || target.grant === 'owner') return false
  }
  return true
}

// Resolves the caller's membership and checks the verb. Non-members, removed
// members and deleted workspaces all get 404 (don't leak existence — same rule
// as private rooms). Suspended members are told so.
export async function authorize(userId: string, workspaceId: string, verb: WorkspaceVerb, target?: PolicyTarget): Promise<Actor> {
  const found = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { workspace: true },
  })
  if (!found || found.status === 'removed' || found.workspace.deletedAt) throw notFound('Workspace not found')
  if (found.status === 'suspended') throw httpError(403, 'Your membership in this workspace is suspended', 'MEMBER_SUSPENDED')
  const { workspace, ...member } = found
  const actor = { member, workspace }
  permit(actor, verb, target)
  return actor
}

// For checks that need the target loaded first (authorize with a read verb, load, then permit).
export function permit(actor: Actor, verb: WorkspaceVerb, target?: PolicyTarget) {
  if (!can(actor.member, verb, target)) throw forbidden('Not allowed in this workspace')
}
