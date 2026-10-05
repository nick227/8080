// Teams: routing/visibility groups inside a workspace (doc/09 §3). Admins manage
// teams; a team's leads may also manage its membership. Members may leave a team.
import { db, type TeamRole } from '@project/db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { teamInclude, toTeam } from '../lib/serialize'
import { diff, runAction } from './actions'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize, permit } from './workspacePolicy'

const nameTaken = (err: unknown) => (err as { code?: string })?.code === 'P2002'

async function findTeam(workspaceId: string, teamId: string) {
  const team = await db.team.findFirst({ where: { id: teamId, workspaceId }, include: teamInclude })
  if (!team) throw notFound('Team not found')
  return team
}

const leadsOf = (team: { members: { memberId: string; role: TeamRole }[] }) => team.members.filter((m) => m.role === 'lead').map((m) => m.memberId)

export class TeamService {
  async list(userId: string, workspaceId: string, opts: { includeArchived?: boolean } = {}) {
    await authorize(userId, workspaceId, 'team.read')
    const teams = await db.team.findMany({
      where: { workspaceId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
      include: teamInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })
    return teams.map(toTeam)
  }

  async create(ctx: WorkspaceCtx, workspaceId: string, input: { name: string; description?: string }, idempotencyKey?: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'team.manage')
    const name = input.name.trim()
    if (!name) throw badRequest('Name is required', 'INVALID_NAME')
    try {
      return await runAction(
        { action: 'team.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'team' }, idempotencyKey },
        async (tx) => {
          const team = await tx.team.create({ data: { workspaceId, name, description: input.description ?? null }, include: teamInclude })
          return { value: toTeam(team), targetId: team.id, activities: [{ type: 'team.created', summary: { teamId: team.id, name } }] }
        },
        async (previous) => toTeam(await findTeam(workspaceId, previous.targetId!)),
      )
    } catch (err) {
      if (nameTaken(err)) throw conflict('A team with that name exists', 'TEAM_NAME_TAKEN')
      throw err
    }
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, teamId: string, input: { name?: string; description?: string | null; archived?: boolean }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'team.manage')
    const team = await findTeam(workspaceId, teamId)
    const name = input.name?.trim()
    if (input.name !== undefined && !name) throw badRequest('Name is required', 'INVALID_NAME')
    const archivedAt = input.archived === undefined ? undefined : input.archived ? (team.archivedAt ?? new Date()) : null

    try {
      return await runAction(
        { action: 'team.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'team', id: teamId } },
        async (tx) => {
          const updated = await tx.team.update({ where: { id: teamId }, data: { name, description: input.description, archivedAt }, include: teamInclude })
          const changes = diff(team, updated, ['name', 'description', 'archivedAt'])
          const activities = []
          if (changes.name) activities.push({ type: 'team.renamed', summary: { teamId, from: team.name, to: updated.name } })
          if (changes.archivedAt) activities.push({ type: updated.archivedAt ? 'team.archived' : 'team.restored', summary: { teamId, name: updated.name } })
          return { value: toTeam(updated), changes, activities }
        },
      )
    } catch (err) {
      if (nameTaken(err)) throw conflict('A team with that name exists', 'TEAM_NAME_TAKEN')
      throw err
    }
  }

  // Adds the member, or changes their role in the team.
  async setMember(ctx: WorkspaceCtx, workspaceId: string, teamId: string, memberId: string, input: { role?: TeamRole }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'team.read')
    const team = await findTeam(workspaceId, teamId)
    permit(actor, 'team.members.manage', { kind: 'team', leadMemberIds: leadsOf(team) })
    if (team.archivedAt) throw conflict('This team is archived', 'TEAM_ARCHIVED')
    const member = await db.workspaceMember.findFirst({ where: { id: memberId, workspaceId, status: 'active' }, include: { user: { include: { profile: true } } } })
    if (!member) throw notFound('Member not found')
    const role = input.role ?? 'member'
    const current = team.members.find((m) => m.memberId === memberId)

    return runAction(
      { action: 'team.member.set', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { memberId, role }, target: { type: 'team', id: teamId } },
      async (tx) => {
        await tx.teamMember.upsert({
          where: { teamId_memberId: { teamId, memberId } },
          create: { teamId, workspaceId, memberId, role },
          update: { role },
        })
        const updated = await tx.team.findUniqueOrThrow({ where: { id: teamId }, include: teamInclude })
        const who = { teamId, team: team.name, memberId, name: member.user.profile?.displayName ?? 'Guest' }
        const activities =
          !current ? [{ type: 'team.member_added', summary: { ...who, role } }]
          : current.role !== role ? [{ type: 'team.member_role_changed', summary: { ...who, from: current.role, to: role } }]
          : []
        return { value: toTeam(updated), changes: { [`members.${memberId}`]: [current?.role ?? null, role] }, activities }
      },
    )
  }

  async removeMember(ctx: WorkspaceCtx, workspaceId: string, teamId: string, memberId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'team.read')
    const team = await findTeam(workspaceId, teamId)
    if (memberId !== actor.member.id) permit(actor, 'team.members.manage', { kind: 'team', leadMemberIds: leadsOf(team) })
    const current = team.members.find((m) => m.memberId === memberId)
    if (!current) throw notFound('Not a member of this team')
    const member = await db.workspaceMember.findFirstOrThrow({ where: { id: memberId, workspaceId }, include: { user: { include: { profile: true } } } })

    return runAction(
      { action: 'team.member.remove', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { memberId }, target: { type: 'team', id: teamId } },
      async (tx) => {
        await tx.teamMember.delete({ where: { teamId_memberId: { teamId, memberId } } })
        const updated = await tx.team.findUniqueOrThrow({ where: { id: teamId }, include: teamInclude })
        return {
          value: toTeam(updated),
          changes: { [`members.${memberId}`]: [current.role, null] },
          activities: [{ type: 'team.member_removed', summary: { teamId, team: team.name, memberId, name: member.user.profile?.displayName ?? 'Guest' } }],
        }
      },
    )
  }
}
