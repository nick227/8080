// Attention queue (doc/11). raiseInboxItem is server-only. A member sees and
// updates only their own rows; workspace membership is not enough.
import { db, Prisma } from '@project/db'
import { badRequest, notFound } from '../lib/errors'
import { decodeCursor, encodeCursor, normalizeLimit, page } from '../lib/pagination'
import { runAction } from './actions'
import { toInboxItem, type InboxItemView } from './inboxFanOut'
import { releaseInbox } from './inboxHub'
import { assertSource, parseAction, type InboxAction } from './inboxSource'
import { authorize } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'

export type RaiseInboxItemInput = {
  memberId: string
  type: string
  title: string
  summary: string
  sourceType: string
  sourceId: string
  dedupeKey: string
  action: InboxAction
  deliverAt?: Date | string
}

const text = (value: string, max: number, code: string) => {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) throw badRequest('A required field is missing or too long', code)
  return trimmed
}

const flag = (value: unknown) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined)

export class InboxService {
  /** Server-only. A repeat of the same member and dedupeKey returns the original row. */
  async raise(workspaceId: string, raw: RaiseInboxItemInput): Promise<InboxItemView> {
    const input = {
      ...raw,
      type: text(raw.type, 32, 'INVALID_ITEM'),
      title: text(raw.title, 200, 'INVALID_ITEM'),
      summary: text(raw.summary, 500, 'INVALID_ITEM'),
      dedupeKey: text(raw.dedupeKey, 160, 'INVALID_ITEM'),
      action: parseAction(raw.action),
    }
    const deliverAt = input.deliverAt ? new Date(input.deliverAt) : new Date()
    if (Number.isNaN(deliverAt.getTime())) throw badRequest('Delivery time is invalid', 'INVALID_ITEM')
    const member = await db.workspaceMember.findFirst({ where: { id: input.memberId, workspaceId, status: 'active' } })
    if (!member) throw badRequest('Unknown member', 'INVALID_MEMBER')
    await assertSource(db, workspaceId, input.sourceType, input.sourceId)
    if (input.action.verb === 'compose') {
      const contact = await db.contact.findFirst({ where: { id: input.action.contactId, workspaceId, deletedAt: null } })
      if (!contact) throw badRequest('Unknown contact', 'INVALID_CONTACT')
    }
    const key = `inbox:${input.memberId}:${input.dedupeKey}`
    const view = await runAction(
      { action: 'inbox.raise', workspaceId, actor: { kind: 'system' }, origin: 'system', input: { memberId: input.memberId, dedupeKey: input.dedupeKey }, idempotencyKey: key, target: { type: 'inbox' } },
      async (tx) => {
        const existing = await tx.inboxItem.findUnique({ where: { memberId_dedupeKey: { memberId: input.memberId, dedupeKey: input.dedupeKey } } })
        if (existing) return { value: toInboxItem(existing), targetId: existing.id, result: { id: existing.id } }
        const created = await tx.inboxItem.create({
          data: { workspaceId, memberId: input.memberId, type: input.type, title: input.title, summary: input.summary, sourceType: input.sourceType, sourceId: input.sourceId, action: input.action as Prisma.InputJsonValue, dedupeKey: input.dedupeKey, deliverAt },
        })
        return { value: toInboxItem(created), targetId: created.id, result: { id: created.id } }
      },
      async (previous) => {
        const id = previous.result && typeof previous.result === 'object' && 'id' in previous.result ? String(previous.result.id) : ''
        const row = id ? await db.inboxItem.findFirst({ where: { id, workspaceId } }) : null
        if (!row) throw notFound('Inbox item not found')
        return toInboxItem(row)
      },
    )
    releaseInbox(view)
    return view
  }

  async list(userId: string, workspaceId: string, query: { cursor?: string; limit?: number; archived?: unknown; unread?: unknown; starred?: unknown }) {
    const actor = await authorize(userId, workspaceId, 'inbox.read')
    const limit = normalizeLimit(query.limit)
    const cursor = decodeCursor(query.cursor)
    const archived = flag(query.archived) ?? false
    const unread = flag(query.unread)
    const starred = flag(query.starred)
    const where: Prisma.InboxItemWhereInput = {
      workspaceId,
      memberId: actor.member.id,
      archivedAt: archived ? { not: null } : null,
      deliverAt: { lte: new Date() },
    }
    if (unread !== undefined) where.unread = unread
    if (starred !== undefined) where.starred = starred
    if (cursor) {
      const at = new Date(cursor.createdAt)
      where.OR = [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }]
    }
    const rows = await db.inboxItem.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const listed = page(rows, limit, (row) => encodeCursor({ createdAt: row.createdAt.toISOString(), id: row.id }))
    return { data: listed.data.map(toInboxItem), meta: listed.meta }
  }

  /** Items that became visible after `since` (created, or a timer came due). */
  async due(userId: string, workspaceId: string, since: Date) {
    const actor = await authorize(userId, workspaceId, 'inbox.read')
    const now = new Date()
    const rows = await db.inboxItem.findMany({
      where: {
        workspaceId,
        memberId: actor.member.id,
        deliverAt: { lte: now },
        OR: [{ createdAt: { gt: since } }, { deliverAt: { gt: since } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    })
    return { memberId: actor.member.id, items: rows.map(toInboxItem) }
  }

  async read(ctx: WorkspaceCtx, workspaceId: string, inboxItemId: string, unread: boolean) {
    return this.patch(ctx, workspaceId, inboxItemId, 'inbox.read', { unread }, { unread })
  }

  async star(ctx: WorkspaceCtx, workspaceId: string, inboxItemId: string, starred: boolean) {
    return this.patch(ctx, workspaceId, inboxItemId, 'inbox.star', { starred }, { starred })
  }

  async archive(ctx: WorkspaceCtx, workspaceId: string, inboxItemId: string, archived: boolean) {
    return this.patch(ctx, workspaceId, inboxItemId, 'inbox.archive', { archived }, { archivedAt: archived ? new Date() : null })
  }

  private async patch(ctx: WorkspaceCtx, workspaceId: string, inboxItemId: string, action: string, input: Record<string, unknown>, data: Prisma.InboxItemUpdateInput) {
    const actor = await authorize(ctx.user.id, workspaceId, 'inbox.update')
    const current = await db.inboxItem.findFirst({ where: { id: inboxItemId, workspaceId, memberId: actor.member.id } })
    if (!current) throw notFound('Inbox item not found')
    return runAction(
      { action, workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { inboxItemId, ...input }, target: { type: 'inbox', id: inboxItemId } },
      async (tx) => {
        const updated = await tx.inboxItem.update({ where: { id: current.id }, data })
        return { value: toInboxItem(updated), targetId: updated.id }
      },
    )
  }
}
