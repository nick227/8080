import { db, type Prisma, type RoomVisibility } from '@project/db'
import { randomBytes } from 'crypto'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { roomInclude, toRoom, type RoomRow } from '../lib/serialize'
import { conflict, forbidden, notFound } from '../lib/errors'

type RoomCursor = { t: string; id: string }
type ListOpts = { cursor?: string; limit?: number }

const newInviteCode = () => randomBytes(9).toString('base64url') // 12 chars

// Lobby order: most recently active first, id as tiebreaker.
function activityPage(rows: RoomRow[], limit: number) {
  const result = page(rows, limit, (last) =>
    encodeKeyCursor<RoomCursor>({ t: last.lastActivityAt.toISOString(), id: last.id }),
  )
  return { data: result.data.map(toRoom), meta: result.meta }
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

  async create(ownerId: string, input: { title: string; topic?: string; visibility?: RoomVisibility }) {
    const visibility = input.visibility ?? 'public'
    const room = await db.room.create({
      data: {
        title: input.title.trim(),
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
    return toRoom(await this.viewable(viewerId, roomId))
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

  async update(viewerId: string, roomId: string, input: { title?: string; topic?: string | null; visibility?: RoomVisibility }) {
    const room = await this.viewable(viewerId, roomId)
    if (room.ownerId !== viewerId) throw forbidden('Only the owner can edit this room')

    const visibility = input.visibility ?? room.visibility
    const inviteCode =
      visibility === 'private' ? (room.inviteCode ?? newInviteCode()) : null

    const updated = await db.room.update({
      where: { id: roomId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.topic !== undefined ? { topic: input.topic?.trim().toLowerCase() || null } : {}),
        visibility,
        inviteCode,
      },
      include: roomInclude(viewerId),
    })
    return toRoom(updated)
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
    return toRoom(updated)
  }
}
