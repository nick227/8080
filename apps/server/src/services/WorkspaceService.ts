// Workspaces, membership and invites (doc/09 slice 0). Permission checks go
// through workspacePolicy; every mutation is a runAction (audit + timeline).
import { createHash, randomBytes } from 'crypto'
import { db, Prisma, type ActionOrigin, type MemberStatus, type WorkspaceRole } from '@project/db'
import { badRequest, conflict, forbidden, httpError, notFound } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import {
  activityInclude,
  toActionExecution,
  toActivity,
  toWorkspace,
  toWorkspaceInvite,
  toWorkspaceMember,
  workspaceMemberInclude,
  type UserRow,
} from '../lib/serialize'
import { events } from './events'
import { diff, runAction, type ActionActor } from './actions'
import { redactRooms } from './records'
import { authorize, permit, type Actor } from './workspacePolicy'
import { createPlatformConnection } from './agents/connections'
import { ensurePipelineStages } from './PipelineService'
import { ensureContactCategories } from './TagService'
import { ensureInventoryCategories } from './VocabularyService'

type Tx = Prisma.TransactionClient

/** Who is acting and through what (cookie session = ui, bearer token = api). */
export type WorkspaceCtx = { user: UserRow; origin: ActionOrigin }

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/

export const hashInviteToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const memberActor = (actor: Actor): ActionActor => ({ kind: 'member', userId: actor.member.userId, memberId: actor.member.id })

const memberName = (member: { user: UserRow }) => member.user.profile?.displayName ?? 'Guest'
const normalizeEmail = (email: string) => email.trim().toLowerCase()

function assertTimezone(timezone: string | null | undefined) {
  if (timezone == null) return
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw badRequest(`Unknown time zone "${timezone}"`, 'INVALID_TIMEZONE')
  }
}

function assertSlug(slug: string | undefined) {
  if (slug !== undefined && !SLUG.test(slug)) throw badRequest('Slug must be lower-case letters, digits and dashes', 'INVALID_SLUG')
}

// Membership is for registered people (D8); bots never join (D11).
function assertCanJoin(user: UserRow) {
  if (user.isGuest || !user.email) throw httpError(403, 'Create an account to use workspaces', 'REGISTRATION_REQUIRED')
  if (user.kind !== 'human') throw forbidden('Bots cannot join workspaces')
}

function slugBase(name: string) {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return base || 'workspace'
}

async function freeSlug(name: string) {
  const base = slugBase(name)
  const candidates = [base, ...Array.from({ length: 8 }, (_, i) => `${base}-${i + 2}`)]
  const taken = new Set((await db.workspace.findMany({ where: { slug: { in: candidates } }, select: { slug: true } })).map((w) => w.slug))
  return candidates.find((c) => !taken.has(c)) ?? `${base}-${randomBytes(3).toString('hex')}`
}

const slugTaken = (err: unknown) => (err as { code?: string; meta?: { target?: unknown } })?.code === 'P2002' && String((err as any).meta?.target ?? '').includes('slug')

// A workspace always keeps an active owner. Locks the owner rows so two owners
// demoting each other at once can't both succeed.
async function assertAnotherOwner(tx: Tx, workspaceId: string, memberId: string) {
  const owners = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM WorkspaceMember WHERE workspaceId = ${workspaceId} AND role = 'owner' AND status = 'active' FOR UPDATE`
  if (!owners.some((o) => o.id !== memberId)) throw conflict('A workspace needs at least one active owner', 'LAST_OWNER')
}

async function findMember(workspaceId: string, memberId: string) {
  const member = await db.workspaceMember.findFirst({
    where: { id: memberId, workspaceId, status: { not: 'removed' } },
    include: workspaceMemberInclude,
  })
  if (!member) throw notFound('Member not found')
  return member
}

export class WorkspaceService {
  // ─── workspaces ────────────────────────────────────────────────────────────

  async create(ctx: WorkspaceCtx, input: { name: string; slug?: string; timezone?: string; defaultCurrency?: string }) {
    assertCanJoin(ctx.user)
    const name = input.name.trim()
    if (!name) throw badRequest('Name is required', 'INVALID_NAME')
    assertSlug(input.slug)
    assertTimezone(input.timezone)
    const slug = input.slug ?? (await freeSlug(name))

    try {
      const created = await runAction(
        { action: 'workspace.create', actor: { kind: 'member', userId: ctx.user.id }, origin: ctx.origin, input, target: { type: 'workspace' } },
        async (tx) => {
          const workspace = await tx.workspace.create({
            data: { name, slug, timezone: input.timezone, defaultCurrency: input.defaultCurrency, createdById: ctx.user.id },
          })
          const member = await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: ctx.user.id, role: 'owner' } })
          // "Send with 8080" is every workspace's sender from the start (docs/agents/07).
          await createPlatformConnection(tx, workspace, ctx.user.email ?? null, member.id)
          await ensurePipelineStages(tx, workspace.id)
          await ensureInventoryCategories(tx, workspace.id)
          await ensureContactCategories(tx, workspace.id)
          return {
            value: toWorkspace(workspace, 'owner'),
            workspaceId: workspace.id,
            actorMemberId: member.id,
            targetId: workspace.id,
            activities: [{ type: 'workspace.created', summary: { name } }],
          }
        },
      )
      const owner = await db.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: created.id, userId: ctx.user.id } }, select: { id: true } })
      events.emit('workspace.member.activated', { workspaceId: created.id, userId: ctx.user.id, memberId: owner.id, creator: true })
      return created
    } catch (err) {
      if (slugTaken(err)) throw conflict('That slug is taken', 'SLUG_TAKEN')
      throw err
    }
  }

  async listMine(userId: string) {
    const members = await db.workspaceMember.findMany({
      where: { userId, status: 'active', workspace: { deletedAt: null } },
      include: { workspace: true },
      orderBy: { joinedAt: 'asc' },
    })
    return members.map((m) => toWorkspace(m.workspace, m.role))
  }

  async get(userId: string, workspaceId: string) {
    const actor = await authorize(userId, workspaceId, 'workspace.read')
    return toWorkspace(actor.workspace, actor.member.role)
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, input: { name?: string; slug?: string; timezone?: string; defaultCurrency?: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'workspace.update')
    const name = input.name?.trim()
    if (input.name !== undefined && !name) throw badRequest('Name is required', 'INVALID_NAME')
    assertSlug(input.slug)
    assertTimezone(input.timezone)

    try {
      return await runAction(
        { action: 'workspace.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'workspace', id: workspaceId } },
        async (tx) => {
          const updated = await tx.workspace.update({
            where: { id: workspaceId },
            data: { name, slug: input.slug, timezone: input.timezone, defaultCurrency: input.defaultCurrency },
          })
          const changes = diff(actor.workspace, updated, ['name', 'slug', 'timezone', 'defaultCurrency'])
          return {
            value: toWorkspace(updated, actor.member.role),
            changes,
            activities: changes.name ? [{ type: 'workspace.renamed', summary: { from: actor.workspace.name, to: updated.name } }] : [],
          }
        },
      )
    } catch (err) {
      if (slugTaken(err)) throw conflict('That slug is taken', 'SLUG_TAKEN')
      throw err
    }
  }

  // Soft delete; pending invites stop working. Members lose access at once (404).
  async remove(ctx: WorkspaceCtx, workspaceId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'workspace.delete')
    await runAction(
      { action: 'workspace.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'workspace', id: workspaceId } },
      async (tx) => {
        const now = new Date()
        await tx.workspace.update({ where: { id: workspaceId }, data: { deletedAt: now } })
        await tx.workspaceInvite.updateMany({ where: { workspaceId, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } })
        return { value: null }
      },
    )
  }

  // ─── members ───────────────────────────────────────────────────────────────

  async listMembers(userId: string, workspaceId: string, opts: { includeRemoved?: boolean } = {}) {
    await authorize(userId, workspaceId, 'member.read')
    const members = await db.workspaceMember.findMany({
      where: { workspaceId, ...(opts.includeRemoved ? {} : { status: { not: 'removed' } }) },
      include: workspaceMemberInclude,
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    })
    return members.map(toWorkspaceMember)
  }

  // Everyone may edit their own title/timezone; role and status need member.manage
  // (and only owners touch owners — see workspacePolicy).
  async updateMember(
    ctx: WorkspaceCtx,
    workspaceId: string,
    memberId: string,
    input: { role?: WorkspaceRole; status?: Exclude<MemberStatus, 'removed'>; title?: string | null; timezone?: string | null },
  ) {
    const actor = await authorize(ctx.user.id, workspaceId, 'member.read')
    const target = await findMember(workspaceId, memberId)
    const self = target.id === actor.member.id
    const managing = input.role !== undefined || input.status !== undefined
    if (managing || !self) permit(actor, 'member.manage', { kind: 'member', role: target.role, grant: input.role })
    if (self && input.status === 'suspended') throw badRequest("You can't suspend yourself", 'SELF_SUSPEND')
    assertTimezone(input.timezone)

    return runAction(
      { action: 'member.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'member', id: memberId } },
      async (tx) => {
        const losesOwner = target.role === 'owner' && target.status === 'active' && ((input.role && input.role !== 'owner') || input.status === 'suspended')
        if (losesOwner) await assertAnotherOwner(tx, workspaceId, target.id)
        const updated = await tx.workspaceMember.update({
          where: { id: memberId },
          data: { role: input.role, status: input.status, title: input.title, timezone: input.timezone },
          include: workspaceMemberInclude,
        })
        const changes = diff(target, updated, ['role', 'status', 'title', 'timezone'])
        const who = { memberId, name: memberName(target) }
        const activities = []
        if (changes.role) activities.push({ type: 'member.role_changed', summary: { ...who, from: target.role, to: updated.role } })
        if (changes.status) activities.push({ type: updated.status === 'suspended' ? 'member.suspended' : 'member.reactivated', summary: who })
        return { value: toWorkspaceMember(updated), changes, activities }
      },
    )
  }

  // Removing yourself is leaving. The row stays (status removed) so history and
  // ownership resolve; team memberships end. Reassigning owned records joins this
  // step when the domains that have owners land (doc/09 §9.7).
  async removeMember(ctx: WorkspaceCtx, workspaceId: string, memberId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'member.read')
    const target = await findMember(workspaceId, memberId)
    const self = target.id === actor.member.id
    if (!self) permit(actor, 'member.manage', { kind: 'member', role: target.role })

    await runAction(
      { action: self ? 'member.leave' : 'member.remove', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'member', id: memberId } },
      async (tx) => {
        if (target.role === 'owner' && target.status === 'active') await assertAnotherOwner(tx, workspaceId, target.id)
        await tx.workspaceMember.update({ where: { id: memberId }, data: { status: 'removed', removedAt: new Date() } })
        await tx.teamMember.deleteMany({ where: { workspaceId, memberId } })
        return {
          value: null,
          changes: { status: [target.status, 'removed'] },
          activities: [{ type: self ? 'member.left' : 'member.removed', summary: { memberId, name: memberName(target) } }],
        }
      },
    )
  }

  // ─── invites ───────────────────────────────────────────────────────────────

  // Returns the token once. A new invite for the same email replaces the pending one.
  async createInvite(ctx: WorkspaceCtx, workspaceId: string, input: { email: string; role?: Exclude<WorkspaceRole, 'owner'> }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'member.invite')
    const email = normalizeEmail(input.email)
    const role = input.role ?? 'member'
    const existing = await db.workspaceMember.findFirst({ where: { workspaceId, status: { not: 'removed' }, user: { email } } })
    if (existing) throw conflict('That person is already a member', 'ALREADY_MEMBER')

    const token = randomBytes(24).toString('base64url')
    const invite = await runAction(
      { action: 'member.invite', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { email, role }, target: { type: 'invite' } },
      async (tx) => {
        const now = new Date()
        await tx.workspaceInvite.updateMany({ where: { workspaceId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } })
        const invite = await tx.workspaceInvite.create({
          data: { workspaceId, email, role, tokenHash: hashInviteToken(token), invitedById: actor.member.id, expiresAt: new Date(now.getTime() + INVITE_TTL_MS) },
        })
        return { value: invite, targetId: invite.id, activities: [{ type: 'member.invited', summary: { email, role } }] }
      },
    )
    return { data: toWorkspaceInvite(invite), token }
  }

  async listInvites(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'member.invite')
    const invites = await db.workspaceInvite.findMany({
      where: { workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    return invites.map(toWorkspaceInvite)
  }

  async revokeInvite(ctx: WorkspaceCtx, workspaceId: string, inviteId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'member.invite')
    const invite = await db.workspaceInvite.findFirst({ where: { id: inviteId, workspaceId, acceptedAt: null, revokedAt: null } })
    if (!invite) throw notFound('Invite not found')
    await runAction(
      { action: 'invite.revoke', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'invite', id: inviteId } },
      async (tx) => {
        await tx.workspaceInvite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } })
        return { value: null }
      },
    )
  }

  /** What an invite link offers, before accepting (read-only; any signed-in session,
   *  guests included). The token itself is the secret, so it travels in the body. */
  async previewInvite(token: string) {
    const invite = await db.workspaceInvite.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: { workspace: { select: { name: true, deletedAt: true } }, invitedBy: { select: { user: { select: { profile: { select: { displayName: true } } } } } } },
    })
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date() || invite.workspace.deletedAt) {
      throw httpError(404, 'This invite is invalid or has expired', 'INVITE_INVALID')
    }
    return {
      workspaceName: invite.workspace.name,
      inviterName: invite.invitedBy?.user.profile?.displayName ?? null,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
    }
  }

  // The invite is bound to an email: the accepting account must own it, so a
  // forwarded link can't be used by someone else.
  async acceptInvite(ctx: WorkspaceCtx, token: string) {
    const invalid = () => httpError(404, 'This invite is invalid or has expired', 'INVITE_INVALID')
    const invite = await db.workspaceInvite.findUnique({ where: { tokenHash: hashInviteToken(token) }, include: { workspace: true } })
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date() || invite.workspace.deletedAt) throw invalid()
    assertCanJoin(ctx.user)
    if (normalizeEmail(ctx.user.email!) !== invite.email) throw httpError(403, 'This invite was sent to a different email address', 'INVITE_EMAIL_MISMATCH')
    const existing = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: ctx.user.id } } })
    if (existing?.status === 'suspended') throw httpError(403, 'Your membership in this workspace is suspended', 'MEMBER_SUSPENDED')

    const accepted = await runAction(
      {
        action: 'invite.accept',
        workspaceId: invite.workspaceId,
        actor: { kind: 'member', userId: ctx.user.id, memberId: existing?.id },
        origin: ctx.origin,
        input: { inviteId: invite.id },
        target: { type: 'member' },
      },
      async (tx) => {
        const claimed = await tx.workspaceInvite.updateMany({ where: { id: invite.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } })
        if (claimed.count === 0) throw invalid()
        // Already active (e.g. joined through another invite): accepting changes nothing.
        if (existing?.status === 'active') return { value: toWorkspace(invite.workspace, existing.role), targetId: existing.id }
        const member = existing
          ? await tx.workspaceMember.update({
              where: { id: existing.id },
              data: { status: 'active', role: invite.role, removedAt: null, joinedAt: new Date(), invitedById: invite.invitedById },
            })
          : await tx.workspaceMember.create({ data: { workspaceId: invite.workspaceId, userId: ctx.user.id, role: invite.role, invitedById: invite.invitedById } })
        return {
          value: toWorkspace(invite.workspace, member.role),
          actorMemberId: member.id,
          targetId: member.id,
          activities: [{ type: 'member.joined', summary: { memberId: member.id, name: memberName({ user: ctx.user }), role: member.role } }],
        }
      },
    )
    if (existing?.status !== 'active') {
      const member = await db.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: ctx.user.id } }, select: { id: true } })
      events.emit('workspace.member.activated', { workspaceId: invite.workspaceId, userId: ctx.user.id, memberId: member.id, creator: false })
    }
    return accepted
  }

  // ─── timeline and audit ────────────────────────────────────────────────────

  async listActivity(userId: string, workspaceId: string, opts: { cursor?: string; limit?: number }) {
    await authorize(userId, workspaceId, 'activity.read')
    const limit = normalizeLimit(opts.limit)
    const cursor = decodeKeyCursor<{ at: string; id: string }>(opts.cursor)
    const rows = await db.activity.findMany({
      where: { workspaceId, ...(cursor ? keysetBefore('occurredAt', cursor) : {}) },
      include: activityInclude,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const result = page(rows, limit, (last) => encodeKeyCursor({ at: last.occurredAt.toISOString(), id: last.id }))
    return { data: await redactRooms(userId, result.data.map(toActivity)), meta: result.meta }
  }

  async listActions(userId: string, workspaceId: string, opts: { cursor?: string; limit?: number; targetType?: string; targetId?: string }) {
    await authorize(userId, workspaceId, 'audit.read')
    const limit = normalizeLimit(opts.limit)
    const cursor = decodeKeyCursor<{ at: string; id: string }>(opts.cursor)
    const rows = await db.actionExecution.findMany({
      where: {
        workspaceId,
        ...(opts.targetType ? { targetType: opts.targetType } : {}),
        ...(opts.targetId ? { targetId: opts.targetId } : {}),
        ...(cursor ? keysetBefore('requestedAt', cursor) : {}),
      },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const result = page(rows, limit, (last) => encodeKeyCursor({ at: last.requestedAt.toISOString(), id: last.id }))
    return { data: result.data.map(toActionExecution), meta: result.meta }
  }
}

// Newest-first keyset: rows strictly after the cursor in (at desc, id desc) order.
function keysetBefore(field: 'occurredAt' | 'requestedAt', cursor: { at: string; id: string }) {
  const at = new Date(cursor.at)
  if (Number.isNaN(at.getTime()) || typeof cursor.id !== 'string') throw badRequest('Invalid cursor')
  return { OR: [{ [field]: { lt: at } }, { [field]: at, id: { lt: cursor.id } }] }
}
