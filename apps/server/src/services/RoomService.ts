import { db, Prisma, type RoomVisibility } from '@project/db'
import { randomBytes } from 'crypto'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { roomInclude, toRoom, type MediaRow, type RoomRow } from '../lib/serialize'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'

type RoomCursor = { t: string; id: string }
type ListOpts = { cursor?: string; limit?: number }

const newInviteCode = () => randomBytes(9).toString('base64url') // 12 chars

// A picture a card can show: a stored image, a YouTube video (its thumbnail) or a poster.
const pictured: Prisma.MediaWhereInput = { OR: [{ kind: 'image' }, { source: 'youtube' }, { posterUrl: { not: null } }] }

// For rooms without a thumbnail: the first picture of their earliest live item that has one.
async function fallbackPictures(rooms: RoomRow[]): Promise<Map<string, MediaRow>> {
  const ids = rooms.filter((r) => !r.thumbnail).map((r) => r.id)
  const found = new Map<string, MediaRow>()
  if (ids.length === 0) return found
  const firsts = await db.$queryRaw<{ roomId: string; number: number }[]>`
    SELECT i.roomId AS roomId, MIN(i.number) AS number
    FROM Item i JOIN Media m ON m.messageId = i.messageId
    WHERE i.roomId IN (${Prisma.join(ids)}) AND i.deletedAt IS NULL
      AND (m.kind = 'image' OR m.source = 'youtube' OR m.posterUrl IS NOT NULL)
    GROUP BY i.roomId`
  if (firsts.length === 0) return found
  const items = await db.item.findMany({
    where: { OR: firsts.map((f) => ({ roomId: f.roomId, number: Number(f.number) })) },
    select: { roomId: true, message: { select: { media: { where: pictured, orderBy: { position: 'asc' }, take: 1 } } } },
  })
  for (const item of items) if (item.message.media[0]) found.set(item.roomId, item.message.media[0])
  return found
}

async function withFallback(room: RoomRow) {
  return toRoom(room, (await fallbackPictures([room])).get(room.id) ?? null)
}

// Lobby order: most recently active first, id as tiebreaker.
async function activityPage(rows: RoomRow[], limit: number) {
  const result = page(rows, limit, (last) =>
    encodeKeyCursor<RoomCursor>({ t: last.lastActivityAt.toISOString(), id: last.id }),
  )
  const pictures = await fallbackPictures(result.data)
  return { data: result.data.map((room) => toRoom(room, pictures.get(room.id) ?? null)), meta: result.meta }
}

function afterCursor(cursor?: string): Prisma.RoomWhereInput {
  const c = decodeKeyCursor<RoomCursor>(cursor)
  if (!c) return {}
  const t = new Date(c.t)
  if (Number.isNaN(t.getTime()) || typeof c.id !== 'string') throw { statusCode: 400, message: 'Invalid cursor' }
  return { OR: [{ lastActivityAt: { lt: t } }, { lastActivityAt: t, id: { lt: c.id } }] }
}

const activityOrder: Prisma.RoomOrderByWithRelationInput[] = [{ lastActivityAt: 'desc' }, { id: 'desc' }]

export class RoomService {
  async listPublic(viewerId: string, opts: ListOpts & { q?: string; topic?: string }) {
    const limit = normalizeLimit(opts.limit)
    const rows = await db.room.findMany({
      where: {
        visibility: 'public',
        deletedAt: null,
        ...(opts.q ? { title: { contains: opts.q } } : {}),
        ...(opts.topic ? { topic: opts.topic } : {}),
        ...afterCursor(opts.cursor),
      },
      orderBy: activityOrder,
      take: limit + 1,
      include: roomInclude(viewerId),
    })
    return activityPage(rows, limit)
  }

  async listMine(viewerId: string, opts: ListOpts) {
    const limit = normalizeLimit(opts.limit)
    const rows = await db.room.findMany({
      where: { deletedAt: null, members: { some: { userId: viewerId } }, ...afterCursor(opts.cursor) },
      orderBy: activityOrder,
      take: limit + 1,
      include: roomInclude(viewerId),
    })
    return activityPage(rows, limit)
  }

  // A thumbnail is the caller's own stored image, or a YouTube video they added
  // (shown by its YouTube thumbnail).
  async ownImage(ownerId: string, mediaId: string) {
    const media = await db.media.findFirst({ where: { id: mediaId, ownerId, OR: [{ kind: 'image' }, { source: 'youtube' }] } })
    if (!media) throw badRequest('Thumbnail must be an image (or YouTube video) you added', 'INVALID_THUMBNAIL')
  }

  // Name, description and picture are all optional (blank is fine).
  async create(ownerId: string, input: { title?: string; description?: string; thumbnailId?: string; topic?: string; visibility?: RoomVisibility }) {
    const visibility = input.visibility ?? 'public'
    if (input.thumbnailId) await this.ownImage(ownerId, input.thumbnailId)
    const room = await db.room.create({
      data: {
        title: input.title?.trim() ?? '',
        description: input.description?.trim() ?? '',
        thumbnailId: input.thumbnailId ?? null,
        topic: input.topic?.trim().toLowerCase() || null,
        visibility,
        inviteCode: visibility === 'private' ? newInviteCode() : null,
        ownerId,
        members: { create: { userId: ownerId, role: 'owner' } },
      },
      include: roomInclude(ownerId),
    })
    return toRoom(room)
  }

  async get(viewerId: string, roomId: string) {
    return withFallback(await this.viewable(viewerId, roomId))
  }

  // Loads a room the viewer may see. Private rooms are 404 to non-members so
  // their existence isn't leaked.
  async viewable(viewerId: string, roomId: string) {
    const room = await db.room.findFirst({
      where: { id: roomId, deletedAt: null },
      include: roomInclude(viewerId),
    })
    if (!room) throw notFound('Room not found')
    if (room.visibility === 'private' && room.members.length === 0) throw notFound('Room not found')
    return room
  }

  // Posting/reacting in a public room implicitly joins it.
  async ensureMember(viewerId: string, room: RoomRow) {
    if (room.members.length > 0) return
    await db.roomMember.upsert({
      where: { roomId_userId: { roomId: room.id, userId: viewerId } },
      create: { roomId: room.id, userId: viewerId },
      update: {},
    })
  }

  async update(viewerId: string, roomId: string, input: { title?: string; description?: string; thumbnailId?: string; topic?: string | null; visibility?: RoomVisibility }) {
    const room = await this.viewable(viewerId, roomId)
    if (room.ownerId !== viewerId) throw forbidden('Only the owner can edit this room')
    if (input.thumbnailId) await this.ownImage(viewerId, input.thumbnailId)

    const visibility = input.visibility ?? room.visibility
    const inviteCode =
      visibility === 'private' ? (room.inviteCode ?? newInviteCode()) : null

    const updated = await db.room.update({
      where: { id: roomId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.thumbnailId !== undefined ? { thumbnailId: input.thumbnailId } : {}),
        ...(input.topic !== undefined ? { topic: input.topic?.trim().toLowerCase() || null } : {}),
        visibility,
        inviteCode,
      },
      include: roomInclude(viewerId),
    })
    return withFallback(updated)
  }

  async remove(viewerId: string, roomId: string) {
    const room = await this.viewable(viewerId, roomId)
    if (room.ownerId !== viewerId) throw forbidden('Only the owner can delete this room')
    await db.room.update({ where: { id: roomId }, data: { deletedAt: new Date() } })
  }

  async join(viewerId: string, roomId: string, inviteCode?: string) {
    const room = await db.room.findFirst({
      where: { id: roomId, deletedAt: null },
      include: roomInclude(viewerId),
    })
    if (!room) throw notFound('Room not found')

    const isMember = room.members.length > 0
    if (!isMember && room.visibility === 'private' && (!inviteCode || inviteCode !== room.inviteCode)) {
      throw notFound('Room not found') // wrong code looks the same as no room
    }

    if (!isMember) {
      await db.roomMember.upsert({
        where: { roomId_userId: { roomId, userId: viewerId } },
        create: { roomId, userId: viewerId },
        update: {},
      })
    }
    return this.get(viewerId, roomId)
  }

  async leave(viewerId: string, roomId: string) {
    const room = await this.viewable(viewerId, roomId)
    if (room.ownerId === viewerId) throw forbidden('Owners cannot leave their own room')
    await db.roomMember.deleteMany({ where: { roomId, userId: viewerId } })
  }

  async rotateInviteCode(viewerId: string, roomId: string) {
    const room = await this.viewable(viewerId, roomId)
    if (room.ownerId !== viewerId) throw forbidden('Only the owner can rotate the invite code')
    if (room.visibility !== 'private') throw conflict('Public rooms have no invite code', 'ROOM_PUBLIC')

    const updated = await db.room.update({
      where: { id: roomId },
      data: { inviteCode: newInviteCode() },
      include: roomInclude(viewerId),
    })
    return withFallback(updated)
  }
}
