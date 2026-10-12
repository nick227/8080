// A conversation message tells the people in the room (doc/11), each in their own
// inbox: rooms belong to no workspace, so these rows are the person's (userId) and
// link to the room. Addressed to you = an @mention or a reply to your message (these
// are pushed, services/push.ts); anything else is an inbox-only "message".
// People outside the room are never told, so a private room stays private; nobody
// hears from someone they muted, and guests (who have no inbox) get nothing.
import { createHash } from 'node:crypto'
import { db, type MediaKind } from '@project/db'
import { mentionedIn } from '../lib/mentions'
import { toUserInboxItem } from './inboxFanOut'
import { releaseInbox } from './inboxHub'

export type ConversationNoticeKind = 'mention' | 'reply' | 'message'

const SAID: Record<MediaKind, string> = { audio: 'Sent a voice message', video: 'Sent a video', image: 'Sent a photo', file: 'Sent a file' }

/** What the message says, short enough for a lock screen. */
function preview(text: string, media: MediaKind | undefined) {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat) return `“${flat.length > 140 ? `${flat.slice(0, 139).trimEnd()}…` : flat}”`
  return media ? SAID[media] : 'Sent a message'
}

/** One row per person and message, whatever retries happen: the id is derived from both. */
const rowId = (userId: string, itemId: string) => `cn${createHash('sha256').update(`${userId}:${itemId}`).digest('hex').slice(0, 23)}`

export async function notifyConversation(input: {
  roomId: string
  itemId: string
  text: string | null
  actorKind: 'human' | 'bot'
  actorUserId: string
  /** The item this one replies to (same room). */
  parentId?: string | null
}) {
  const room = await db.room.findFirst({
    where: { id: input.roomId, deletedAt: null },
    select: { members: { select: { userId: true, user: { select: { isGuest: true, profile: { select: { displayName: true } } } } } } },
  })
  if (!room) return
  const muters = new Set((await db.userMute.findMany({
    where: { mutedUserId: input.actorUserId, userId: { in: room.members.map((m) => m.userId) } },
    select: { userId: true },
  })).map((m) => m.userId))
  const recipients = room.members.filter((m) => m.userId !== input.actorUserId && !m.user.isGuest && !muters.has(m.userId))
  if (!recipients.length) return

  const [actor, item, parent] = await Promise.all([
    db.user.findUnique({ where: { id: input.actorUserId }, select: { profile: { select: { displayName: true } } } }),
    db.item.findUnique({ where: { id: input.itemId }, select: { message: { select: { media: { select: { kind: true }, orderBy: { position: 'asc' }, take: 1 } } } } }),
    input.parentId
      ? db.item.findFirst({ where: { id: input.parentId, roomId: input.roomId, deletedAt: null }, select: { message: { select: { authorId: true } } } })
      : null,
  ])
  const who = actor?.profile?.displayName?.trim() || (input.actorKind === 'bot' ? 'The assistant' : 'Someone')
  const text = input.text ?? ''
  // Task comment rules: "@Ana Lopez", or "@Ana" when no one else in the room is an Ana.
  const mentioned = new Set(text ? mentionedIn(text, room.members.map((m) => ({ id: m.userId, name: m.user.profile?.displayName ?? '' }))) : [])
  const repliedTo = parent?.message.authorId ?? null
  const summary = preview(text, item?.message.media[0]?.kind)

  const rows = recipients.map(({ userId }) => {
    // A mention wins over a reply: one notice per person per message.
    const kind: ConversationNoticeKind = mentioned.has(userId) ? 'mention' : userId === repliedTo ? 'reply' : 'message'
    return {
      id: rowId(userId, input.itemId),
      userId,
      type: kind,
      title: (kind === 'mention' ? `${who} mentioned you` : kind === 'reply' ? `${who} replied to you` : who).slice(0, 200),
      summary,
      sourceType: 'conversation',
      sourceId: input.roomId,
      dedupeKey: input.itemId,
      action: { verb: 'open' },
    }
  })
  await db.inboxItem.createMany({ data: rows, skipDuplicates: true })
  const created = await db.inboxItem.findMany({ where: { id: { in: rows.map((r) => r.id) } } })
  for (const row of created) releaseInbox(toUserInboxItem(row))
}
