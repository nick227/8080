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
  const byWorkspace = new Map<string, { id: string; userId: string }[]>()
  for (const membership of memberships) {
    const list = byWorkspace.get(membership.workspaceId) ?? []
    list.push(membership)
    byWorkspace.set(membership.workspaceId, list)
  }
  const title = input.actorKind === 'bot' ? 'The assistant spoke' : 'A teammate spoke'
  const summary = (input.text ?? '').trim().slice(0, 500) || 'New activity'
  for (const [workspaceId, members] of byWorkspace) {
    const actor = members.find((member) => member.userId === input.actorUserId)
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
          actorMemberId: actor?.id ?? null,
          memberIds: members.map((member) => member.id),
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
