// Prisma rows → API shapes (packages/api-spec). The only place DB fields are
// renamed or hidden: kind→type, posterUrl→poster, storageKey→url, no passwordHash.
import type { Prisma, ReactionType } from '@project/db'
import { storage } from '../providers/storage'
import { youTubeThumbnailUrl, youTubeWatchUrl } from '@project/shared'

// ─── users ───────────────────────────────────────────────────────────────────

export type UserRow = Prisma.UserGetPayload<{ include: { profile: true } }>

export function toUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    isGuest: user.isGuest,
    displayName: user.profile?.displayName ?? 'Guest',
    avatarUrl: user.profile?.avatarUrl ?? null,
    createdAt: user.createdAt,
  }
}

export function toAuthor(user: UserRow) {
  return {
    id: user.id,
    name: user.profile?.displayName ?? 'Guest',
    avatarUrl: user.profile?.avatarUrl ?? null,
  }
}

// ─── rooms ───────────────────────────────────────────────────────────────────

export function roomInclude(viewerId: string) {
  return {
    _count: { select: { members: true } },
    members: { where: { userId: viewerId }, select: { role: true } },
  } satisfies Prisma.RoomInclude
}

export type RoomRow = Prisma.RoomGetPayload<{ include: ReturnType<typeof roomInclude> }>

export function toRoom(room: RoomRow) {
  const role = room.members[0]?.role ?? null
  return {
    id: room.id,
    number: room.number,
    title: room.title,
    topic: room.topic,
    visibility: room.visibility,
    ownerId: room.ownerId,
    itemCount: room.itemCount,
    memberCount: room._count.members,
    lastActivityAt: room.lastActivityAt,
    createdAt: room.createdAt,
    role,
    // Only members of a private room may see (and share) its invite code.
    inviteCode: room.visibility === 'private' && role ? room.inviteCode : null,
  }
}

// ─── media ───────────────────────────────────────────────────────────────────

export type MediaRow = Prisma.MediaGetPayload<object>

export function toMedia(media: MediaRow) {
  const youtube = media.source === 'youtube' && media.externalId
  return {
    id: media.id,
    type: media.kind,
    source: media.source,
    // External media is referenced, never stored: URL/poster derive from the id.
    url: youtube ? youTubeWatchUrl(media.externalId!) : storage().urlFor(media.storageKey ?? ''),
    mimeType: media.mimeType,
    size: media.size,
    duration: media.duration,
    name: media.name,
    poster: youtube ? youTubeThumbnailUrl(media.externalId!) : media.posterUrl,
    externalId: media.externalId,
    title: media.title,
    embeddable: media.embeddable,
  }
}

// ─── messages + items ────────────────────────────────────────────────────────
// Message = reusable content (author, text, media). Item = its placement in one
// room (number, thread position, reactions). Items always carry the hydrated message.

export const messageInclude = {
  author: { include: { profile: true } },
  media: { orderBy: { position: 'asc' } },
} satisfies Prisma.MessageInclude

export type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>

// `hidden` → this placement was deleted: content is withheld in this room only.
export function toMessage(message: MessageRow, hidden: boolean) {
  return {
    id: message.id,
    author: toAuthor(message.author),
    text: hidden ? null : message.text,
    media: hidden ? [] : message.media.map(toMedia),
    createdAt: message.createdAt,
  }
}

export const itemInclude = {
  message: { include: messageInclude },
  reactions: { select: { type: true, userId: true } },
} satisfies Prisma.ItemInclude

export type ItemRow = Prisma.ItemGetPayload<{ include: typeof itemInclude }>

const REACTION_ORDER: ReactionType[] = ['like', 'ack', 'laugh']

// viewerId null → broadcast payload (SSE): `reacted` is always false.
export function toItem(item: ItemRow, viewerId: string | null) {
  const deleted = item.deletedAt !== null
  const reactions = deleted
    ? []
    : REACTION_ORDER.flatMap((type) => {
        const of = item.reactions.filter((r) => r.type === type)
        if (of.length === 0) return []
        return [{ type, count: of.length, reacted: viewerId !== null && of.some((r) => r.userId === viewerId) }]
      })

  return {
    id: item.id,
    roomId: item.roomId,
    messageId: item.messageId,
    number: item.number,
    parentId: item.parentId,
    anchorStartMs: item.anchorStartMs,
    message: toMessage(item.message, deleted),
    reactions,
    createdAt: item.createdAt,
    deletedAt: item.deletedAt,
  }
}
