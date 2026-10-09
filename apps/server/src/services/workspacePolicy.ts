// The one place workspace permissions are decided (doc/09 §8, D4). Every
// workspace-scoped service call starts with authorize(); handlers never look at
// roles. V1 is deliberately broad: active members read everything, owners/admins
// manage. Record-level rules (ownerMemberId, teamId) arrive with the domains and
// are decided here too — no ACL tables yet.
import { db, type Workspace, type WorkspaceMember, type WorkspaceRole } from '@project/db'
import { forbidden, httpError, notFound } from '../lib/errors'

export type WorkspaceVerb =
  | 'document.create'
  | 'document.read'
  | 'document.edit'
  | 'document.manage'
  | 'dataset.read'
  | 'dataset.export'
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
  // CRM records (contacts, accounts; leads/deals later). V1 is broad (D4): every
  // member reads and edits; deleting or merging away a record is for admins and
  // the record's owner.
  | 'record.read'
  | 'record.write'
  | 'record.delete'
  | 'record.import'
  | 'note.write'
  | 'note.delete'
  | 'link.write'
  | 'tag.create'
  | 'tag.manage'
  | 'inbox.read'
  | 'inbox.update'
  | 'compose.send'
  // The company profile (doc/12 §5.2): everyone reads it; owners and admins shape it.
  | 'companyProfile.read'
  | 'companyProfile.edit'
  // Email senders (docs/agents): everyone sees which sender an Agent uses; admins set them up.
  | 'email.read'
  | 'email.manage'
  // Communication agents: everyone sees them and their activity; admins run them.
  | 'agent.read'
  | 'agent.manage'
  // Calendar/Boards tasks: every member reads, writes, moves and deletes (soft, with Undo).
  | 'task.read'
  | 'task.write'
  | 'task.delete'

const OWNERS: readonly WorkspaceRole[] = ['owner']
const ADMINS: readonly WorkspaceRole[] = ['owner', 'admin']
const EVERYONE: readonly WorkspaceRole[] = ['owner', 'admin', 'member']

const ROLES: Record<WorkspaceVerb, readonly WorkspaceRole[]> = {
  'document.create': EVERYONE,
  'document.read': EVERYONE,
  'document.edit': EVERYONE,
  'document.manage': EVERYONE,
  'dataset.read': EVERYONE,
  'dataset.export': EVERYONE,
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
  'record.read': EVERYONE,
  'record.write': EVERYONE,
  'record.delete': ADMINS, // + the record's owner (below)
  // Bulk canonical import; broad in V1 like record.write, its own verb so it can tighten.
  'record.import': EVERYONE,
  'note.write': EVERYONE,
  'note.delete': ADMINS, // + the note's author (below)
  'link.write': EVERYONE,
  'tag.create': EVERYONE,
  'tag.manage': ADMINS,
  'inbox.read': EVERYONE,
  'inbox.update': EVERYONE,
  'compose.send': EVERYONE,
  'companyProfile.read': EVERYONE,
  'companyProfile.edit': ADMINS,
  'email.read': EVERYONE,
  'email.manage': ADMINS,
  'agent.read': EVERYONE,
  'agent.manage': ADMINS,
  'task.read': EVERYONE,
  'task.write': EVERYONE,
  'task.delete': EVERYONE,
}

// What a verb is applied to, when the answer depends on it.
export type PolicyTarget =
  // `role`: the member being changed; `grant`: the role being given to them.
  | { kind: 'member'; role: WorkspaceRole; grant?: WorkspaceRole }
  | { kind: 'team'; leadMemberIds: readonly string[] }
  | { kind: 'record'; ownerMemberId: string | null }
  | { kind: 'note'; authorMemberId: string }
  // `workspaceAccess`: what every active member gets (null = private to owner + grants).
  | { kind: 'document'; ownerMemberId: string; grants: { memberId: string; role: 'viewer' | 'editor' }[]; workspaceAccess: 'viewer' | 'editor' | null }

export type Actor = { member: WorkspaceMember; workspace: Workspace }

export function can(member: Pick<WorkspaceMember, 'id' | 'role' | 'status'>, verb: WorkspaceVerb, target?: PolicyTarget): boolean {
  if (member.status !== 'active') return false
  if (verb === 'document.read' || verb === 'document.edit' || verb === 'document.manage') {
    if (target?.kind !== 'document') return false
    if (member.role === 'owner' || member.role === 'admin' || target.ownerMemberId === member.id) return true
    const grant = target.grants.find(g => g.memberId === member.id)
    if (verb === 'document.read') return !!grant || target.workspaceAccess !== null
    if (verb === 'document.edit') return grant?.role === 'editor' || target.workspaceAccess === 'editor'
    return false
  }
  if (verb === 'team.members.manage' && target?.kind === 'team' && target.leadMemberIds.includes(member.id)) return true
  if (verb === 'record.delete' && target?.kind === 'record' && target.ownerMemberId === member.id) return true
  if (verb === 'note.delete' && target?.kind === 'note' && target.authorMemberId === member.id) return true
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

// SQL visibility and per-object checks live together to prevent list/detail drift.
export function documentVisibility(actor: Actor) {
  return actor.member.role === 'owner' || actor.member.role === 'admin' ? {} : {
    OR: [{ ownerMemberId: actor.member.id }, { grants: { some: { memberId: actor.member.id } } }, { workspaceAccess: { not: null } }],
  }
}
