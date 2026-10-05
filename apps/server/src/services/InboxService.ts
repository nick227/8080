// Attention queue (doc/11). raiseInboxItem is server-only. A member sees and
// updates only their own rows; workspace membership is not enough.
import { db, Prisma, type InboxItem } from '@project/db'
import { badRequest, notFound } from '../lib/errors'
import { decodeCursor, encodeCursor, normalizeLimit, page } from '../lib/pagination'
import { runAction } from './actions'
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
}

const text = (value: string, max: number, code: string) => {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) throw badRequest('A required field is missing or too long', code)
  return trimmed
}

function serialize(row: InboxItem) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    memberId: row.memberId,
    type: row.type,
    title: row.title,
    summary: row.summary,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    unread: row.unread,
    starred: row.starred,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    action: row.action,
    dedupeKey: row.dedupeKey,
    createdAt: row.createdAt.toISOString(),
  }
}

export type InboxItemView = ReturnType<typeof serialize>

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
    const member = await db.workspaceMember.findFirst({ where: { id: input.memberId, workspaceId, status: 'active' } })
    if (!member) throw badRequest('Unknown member', 'INVALID_MEMBER')
    await assertSource(db, workspaceId, input.sourceType, input.sourceId)
    if (input.action.verb === 'compose') {
      const contact = await db.contact.findFirst({ where: { id: input.action.contactId, workspaceId, deletedAt: null } })
      if (!contact) throw badRequest('Unknown contact', 'INVALID_CONTACT')
    }
    const key = `inbox:${input.memberId}:${input.dedupeKey}`
    return runAction(
      { action: 'inbox.raise', workspaceId, actor: { kind: 'system' }, origin: 'system', input: { memberId: input.memberId, dedupeKey: input.dedupeKey }, idempotencyKey: key, target: { type: 'inbox' } },
      async (tx) => {
        const existing = await tx.inboxItem.findUnique({ where: { memberId_dedupeKey: { memberId: input.memberId, dedupeKey: input.dedupeKey } } })
        if (existing) return { value: serialize(existing), targetId: existing.id, result: { id: existing.id } }
        const created = await tx.inboxItem.create({
          data: { workspaceId, memberId: input.memberId, type: input.type, title: input.title, summary: input.summary, sourceType: input.sourceType, sourceId: input.sourceId, action: input.action as Prisma.InputJsonValue, dedupeKey: input.dedupeKey },
        })
        return { value: serialize(created), targetId: created.id, result: { id: created.id } }
      },
      async (previous) => {
        const id = previous.result && typeof previous.result === 'object' && 'id' in previous.result ? String(previous.result.id) : ''
        const row = id ? await db.inboxItem.findFirst({ where: { id, workspaceId } }) : null
        if (!row) throw notFound('Inbox item not found')
        return serialize(row)
      },
    )
  }

  async list(userId: string, workspaceId: string, query: { cursor?: string; limit?: number; archived?: unknown; unread?: unknown; starred?: unknown }) {
    const actor = await authorize(userId, workspaceId, 'inbox.read')
    const limit = normalizeLimit(query.limit)
    const cursor = decodeCursor(query.cursor)
    const archived = flag(query.archived) ?? false
    const unread = flag(query.unread)
    const starred = flag(query.starred)
    const rows = await db.inboxItem.findMany({
      where: {
        workspaceId,
        memberId: actor.member.id,
        archivedAt: archived ? { not: null } : null,
        ...(unread === undefined ? {} : { unread }),
        ...(starred === undefined ? {} : { starred }),
        ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const listed = page(rows, limit, (row) => encodeCursor({ createdAt: row.createdAt.toISOString(), id: row.id }))
    return { data: listed.data.map(serialize), meta: listed.meta }
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
        return { value: serialize(updated), targetId: updated.id }
      },
    )
  }
}
