// A conversation placement tells the room members who belong to a workspace (doc/11).
// People outside the room are not told, so a private room stays private.
import { db } from '@project/db'
import { runAction } from './actions'
import { fanOut, toInboxItem } from './inboxFanOut'
import { releaseInbox } from './inboxHub'

export async function notifyConversation(input: {
  roomId: string
  itemId: string
  text: string | null
  actorKind: 'human' | 'bot'
  actorUserId: string
}) {
  const room = await db.room.findFirst({
    where: { id: input.roomId, deletedAt: null },
    select: { members: { select: { userId: true } } },
  })
  if (!room) return
  const userIds = room.members.map((member) => member.userId)
  if (!userIds.length) return
  const memberships = await db.workspaceMember.findMany({
    where: { userId: { in: userIds }, status: 'active', workspace: { deletedAt: null } },
    select: { id: true, workspaceId: true, userId: true },
  })
  const byWorkspace = new Map<string, { memberIds: string[]; actorMemberId: string | null }>()
  for (const membership of memberships) {
    let group = byWorkspace.get(membership.workspaceId)
    if (!group) {
      group = { memberIds: [], actorMemberId: null }
      byWorkspace.set(membership.workspaceId, group)
    }
    group.memberIds.push(membership.id)
    if (membership.userId === input.actorUserId) group.actorMemberId = membership.id
  }
  const title = input.actorKind === 'bot' ? 'The assistant spoke' : 'A teammate spoke'
  const summary = (input.text ?? '').trim().slice(0, 500) || 'New activity'
  for (const [workspaceId, group] of byWorkspace) {
    const rows = await runAction(
      {
        action: 'inbox.announce',
        workspaceId,
        actor: { kind: 'system' },
        origin: 'system',
        input: { dedupeKey: input.itemId },
        idempotencyKey: `inbox:${workspaceId}:${input.itemId}`,
        target: { type: 'conversation', id: input.roomId },
      },
      async (tx) => {
        const created = await fanOut(tx, workspaceId, {
          type: input.actorKind === 'bot' ? 'agent' : 'conversation',
          title,
          summary,
          sourceType: 'conversation',
          sourceId: input.roomId,
          dedupeKey: input.itemId,
          action: { verb: 'open' },
          actorMemberId: group.actorMemberId,
          memberIds: group.memberIds,
        })
        return { value: created, result: { count: created.length } }
      },
      async () => {
        const existing = await db.inboxItem.findMany({ where: { workspaceId, dedupeKey: input.itemId } })
        return existing.map(toInboxItem)
      },
    )
    for (const row of rows) releaseInbox(row)
  }
}
