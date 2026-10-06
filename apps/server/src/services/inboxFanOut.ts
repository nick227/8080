// One workspace event becomes one inbox row per member (doc/11). Written inside
// the caller's transaction. The queue's own bookkeeping does not announce again.
import { Prisma, type InboxItem } from '@project/db'
import { assertSource, type InboxAction } from './inboxSource'

type Tx = Prisma.TransactionClient

const SILENT = new Set(['inbox.read', 'inbox.star', 'inbox.archive', 'inbox.raise', 'inbox.announce'])
const SOURCES = new Set(['contact', 'document', 'conversation', 'calendar', 'system'])

export type InboxItemView = {
  id: string
  workspaceId: string
  memberId: string
  type: string
  title: string
  summary: string
  sourceType: string
  sourceId: string
  unread: boolean
  starred: boolean
  archivedAt: string | null
  action: InboxAction
  dedupeKey: string
  deliverAt: string
  createdAt: string
}

export function toInboxItem(row: InboxItem): InboxItemView {
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
    action: row.action as InboxAction,
    dedupeKey: row.dedupeKey,
    deliverAt: row.deliverAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

export type FanOutNotice = {
  type: string
  title: string
  summary: string
  sourceType: string
  sourceId: string
  dedupeKey: string
  action: InboxAction
  deliverAt?: Date
  actorMemberId?: string | null
  memberIds: string[]
}

export async function fanOut(tx: Tx, workspaceId: string, notice: FanOutNotice): Promise<InboxItemView[]> {
  const members = [...new Set(notice.memberIds)]
  if (!members.length) return []
  const deliverAt = notice.deliverAt ?? new Date()
  await tx.inboxItem.createMany({
    data: members.map((memberId) => ({
      workspaceId,
      memberId,
      type: notice.type,
      title: notice.title,
      summary: notice.summary,
      sourceType: notice.sourceType,
      sourceId: notice.sourceId,
      action: notice.action as Prisma.InputJsonValue,
      dedupeKey: notice.dedupeKey,
      deliverAt,
      unread: memberId !== notice.actorMemberId,
    })),
    skipDuplicates: true,
  })
  const rows = await tx.inboxItem.findMany({ where: { workspaceId, dedupeKey: notice.dedupeKey, memberId: { in: members } } })
  return rows.map(toInboxItem)
}

function sentence(action: string) {
  const domain = action.split('.')[0]
  const verb = action.split('.')[1]
  if (!domain || !verb) return action
  const did = verb === 'create' ? 'added' : verb === 'delete' ? 'removed' : verb.replace(/([A-Z])/g, ' $1').toLowerCase()
  return `${domain.charAt(0).toUpperCase()}${domain.slice(1)} ${did}`
}

/** Side effect of a succeeded workspace action. Silent for the queue itself. */
export async function announceAction(tx: Tx, input: {
  workspaceId: string
  action: string
  executionId: string
  actorMemberId: string | null
  targetType: string | null
  targetId: string | null
  notice?: { title: string; summary: string }
}): Promise<InboxItemView[]> {
  if (SILENT.has(input.action)) return []
  const members = await tx.workspaceMember.findMany({ where: { workspaceId: input.workspaceId, status: 'active' }, select: { id: true } })
  let sourceType = 'system'
  let sourceId = input.executionId
  if (input.targetType && input.targetId && SOURCES.has(input.targetType)) {
    try {
      await assertSource(tx, input.workspaceId, input.targetType, input.targetId)
      sourceType = input.targetType
      sourceId = input.targetId
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'INVALID_SOURCE' && code !== 'UNKNOWN_SOURCE') throw err
    }
  }
  const title = (input.notice?.title ?? sentence(input.action)).slice(0, 200)
  const summary = (input.notice?.summary ?? sourceType).slice(0, 500)
  return fanOut(tx, input.workspaceId, {
    type: sourceType === 'conversation' ? 'conversation' : 'system',
    title,
    summary,
    sourceType,
    sourceId,
    dedupeKey: `action:${input.executionId}`,
    action: { verb: 'open' },
    actorMemberId: input.actorMemberId,
    memberIds: members.map((member) => member.id),
  })
}
