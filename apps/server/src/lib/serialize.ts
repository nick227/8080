// Prisma rows → API shapes (packages/api-spec). The only place DB fields are
// renamed or hidden: kind→type, posterUrl→poster, storageKey→url, no passwordHash.
import type { Prisma, ReactionType } from '@project/db'
import { youTubeThumbnailUrl, youTubeWatchUrl } from '@project/shared'
import { playbackToken } from './playbackToken'

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
    thumbnail: true,
    _count: { select: { members: true } },
    members: { where: { userId: viewerId }, select: { role: true } },
  } satisfies Prisma.RoomInclude
}

export type RoomRow = Prisma.RoomGetPayload<{ include: ReturnType<typeof roomInclude> }>

// `fallback`: the room's earliest picture, shown when no thumbnail is set (rooms
// from before thumbnails were required, or whose thumbnail file was deleted).
export function toRoom(room: RoomRow, fallback: MediaRow | null = null) {
  const role = room.members[0]?.role ?? null
  return {
    id: room.id,
    number: room.number,
    title: room.title,
    description: room.description ?? '',
    thumbnail: room.thumbnail ? toMedia(room.thumbnail) : fallback ? toMedia(fallback) : null,
    topic: room.topic,
    visibility: room.visibility,
    ownerId: room.ownerId,
    itemCount: room.itemCount,
    responseCount: room.responseCount,
    durationMs: room.durationMs,
    memberCount: room._count.members,
    lastActivityAt: room.lastActivityAt,
    lastResponseAt: room.lastResponseAt,
    createdAt: room.createdAt,
    role,
    // Only members of a private room may see (and share) its invite code.
    inviteCode: room.visibility === 'private' && role ? room.inviteCode : null,
  }
}

// ─── media ───────────────────────────────────────────────────────────────────

export type MediaRow = Prisma.MediaGetPayload<object>

/** The stored file's playback endpoint, without a token (for places that persist it, e.g. avatars). */
export const playbackUrl = (mediaId: string) => `${process.env.PUBLIC_API_URL ?? 'http://localhost:3001'}/media/${mediaId}/playback`

export function toMedia(media: MediaRow) {
  const youtube = media.source === 'youtube' && media.externalId
  return {
    id: media.id,
    type: media.kind,
    source: media.source,
    // External media is referenced, never stored: URL/poster derive from the id.
    // Stored media: the playback endpoint plus a short-lived token, so media elements
    // with crossOrigin="anonymous" (no cookies) can still play it.
    url: youtube ? youTubeWatchUrl(media.externalId!) : `${playbackUrl(media.id)}?token=${playbackToken(media.id)}`,
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
  let reactions: any[] = []
  if (!deleted && item.reactions.length > 0) {
    const counts: Record<string, number> = { like: 0, ack: 0, laugh: 0 }
    const reacted: Record<string, boolean> = { like: false, ack: false, laugh: false }
    for (const r of item.reactions) {
      counts[r.type] = (counts[r.type] || 0) + 1
      if (viewerId !== null && r.userId === viewerId) reacted[r.type] = true
    }
    reactions = REACTION_ORDER.filter((t) => (counts[t] || 0) > 0).map((t) => ({
      type: t,
      count: counts[t] || 0,
      reacted: reacted[t] || false,
    }))
  }

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
