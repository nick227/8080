import { db, type Prisma } from '@project/db'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { itemInclude, toItem, type ItemRow } from '../lib/serialize'
import { badRequest, forbidden, notFound } from '../lib/errors'
import { RoomService } from './RoomService'
import { streamHub } from './StreamHub'
import { purgeCapture } from './purgeCapture'
import { recountRooms } from './roomStats'

const rooms = new RoomService()

type ItemCursor = { n: number }
type Tx = Prisma.TransactionClient
type ContentInput = { text?: string; mediaIds?: string[] }

// Message = reusable content; Item = its placement in one room.
//   send  → new Message + first Item (top-level)
//   reply → new Message + child Item, always in the parent's room
//   share → new Items only, reusing the Message and its media
export class ItemService {
  // Ascending by per-room number. `after` skips items the client already has.
  async list(viewerId: string, roomId: string, opts: { cursor?: string; limit?: number; after?: number }) {
    await rooms.viewable(viewerId, roomId)
    const limit = normalizeLimit(opts.limit)
    const c = decodeKeyCursor<ItemCursor>(opts.cursor)
    if (c && !Number.isInteger(c.n)) throw { statusCode: 400, message: 'Invalid cursor' }
    const floor = Math.max(opts.after ?? 0, c?.n ?? 0)

    const rows = await db.item.findMany({
      where: { roomId, number: { gt: floor } },
      orderBy: { number: 'asc' },
      take: limit + 1,
      include: itemInclude,
    })
    const result = page(rows, limit, (last) => encodeKeyCursor<ItemCursor>({ n: last.number }))
    return { data: result.data.map((i) => toItem(i, viewerId)), meta: result.meta }
  }



  async get(viewerId: string, itemId: string) {
    const item = await this.loadViewable(viewerId, itemId)
    return toItem(item, viewerId)
  }

  async send(viewerId: string, roomId: string, input: ContentInput) {
    const content = this.content(input)
    const room = await rooms.viewable(viewerId, roomId)
    await rooms.ensureMember(viewerId, room)

    const item = await db.$transaction(async (tx) => {
      const msg = await this.createMessage(tx, viewerId, content)
      return this.place(tx, { roomId, messageId: msg.id, parentId: null })
    })
    return this.publishCreated(viewerId, item)
  }

  async reply(viewerId: string, parentItemId: string, input: ContentInput & { anchorStartMs?: number }) {
    const content = this.content(input)
    // The room comes from the parent — a reply can never land in another room.
    const parent = await this.loadViewable(viewerId, parentItemId)
    const anchorStartMs = input.anchorStartMs === undefined ? null : this.anchor(parent, input.anchorStartMs)
    const room = await rooms.viewable(viewerId, parent.roomId)
    await rooms.ensureMember(viewerId, room)

    const item = await db.$transaction(async (tx) => {
      const msg = await this.createMessage(tx, viewerId, content)
      return this.place(tx, { roomId: parent.roomId, messageId: msg.id, parentId: parent.id, anchorStartMs })
    })
    return this.publishCreated(viewerId, item)
  }

  async share(viewerId: string, messageId: string, roomIds: string[]) {
    const message = await db.message.findFirst({
      where: { id: messageId, deletedAt: null },
      select: { authorId: true, media: { select: { duration: true } }, items: { where: { deletedAt: null }, select: { roomId: true } } },
    })
    // Only the author can re-publish their content (keeps private-room content private).
    // Non-authors who can't see the message get 404, not 403.
    if (!message) throw notFound('Message not found')
    if (message.authorId !== viewerId) {
      const visible = await this.anyVisible(viewerId, message.items.map((i) => i.roomId))
      if (!visible) throw notFound('Message not found')
      throw forbidden('Only the author can share this message')
    }

    // Validate every target before writing anything (all-or-nothing).
    const alreadyIn = new Set(message.items.map((i) => i.roomId))
    
    const uniqueRoomIds = Array.from(new Set(roomIds))
    const roomRows = await db.room.findMany({
      where: {
        id: { in: uniqueRoomIds },
        deletedAt: null,
        OR: [{ visibility: 'public' }, { members: { some: { userId: viewerId } } }],
      },
      include: {
        _count: { select: { members: true } },
        members: { where: { userId: viewerId }, select: { role: true } },
        thumbnail: true,
      }
    })
    
    if (roomRows.length !== uniqueRoomIds.length) {
      throw notFound('Room not found')
    }

    const targets = roomRows.filter(r => !alreadyIn.has(r.id))
    
    // ensureMember does an upsert per room if not already member
    await Promise.all(targets.map(room => rooms.ensureMember(viewerId, room)))

    const created = await db.$transaction(async (tx) => {
      const items: Prisma.ItemGetPayload<{ include: typeof itemInclude }>[] = []
      for (const room of targets) items.push(await this.place(tx, { roomId: room.id, messageId, parentId: null }))
      return items
    })
    return created.map((item) => this.publishCreated(viewerId, item))
  }

  // The author permanently removes the capture (file, media row, text) from every
  // room it was shared to. The placement row stays so replies keep their parent.
  async delete(viewerId: string, itemId: string) {
    const item = await this.loadViewable(viewerId, itemId)
    if (item.message.authorId !== viewerId) throw forbidden('Only the author can delete this item')

    const placements = await purgeCapture(item.messageId, item.message.media)
    for (const placement of placements) {
      streamHub.publish(placement.roomId, { type: 'item.updated', actorId: viewerId, itemId: placement.id, itemNumber: placement.number })
    }

    const updated = await db.item.findUniqueOrThrow({ where: { id: itemId }, include: itemInclude })
    return toItem(updated, viewerId)
  }

  async loadViewable(viewerId: string, itemId: string, extra?: Prisma.ItemWhereInput) {
    const item = await db.item.findFirst({ where: { id: itemId, ...extra }, include: itemInclude })
    if (!item) throw notFound('Item not found')
    await rooms.viewable(viewerId, item.roomId) // 404s for private rooms the viewer can't see
    return item
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  // An anchor is a moment (a point, not a range) in the parent's single, visible
  // audio/video attachment. V1 trusts the uploader-reported duration and refuses
  // anchors it couldn't place: no timed media, several clips, or unknown duration.
  private anchor(parent: ItemRow, anchorStartMs: number) {
    const timed = parent.deletedAt ? [] : parent.message.media.filter((m) => m.kind === 'audio' || m.kind === 'video')
    if (timed.length !== 1) {
      throw badRequest('Anchors need a parent with exactly one audio or video attachment', 'ANCHOR_UNSUPPORTED')
    }
    const duration = timed[0]!.duration
    if (duration == null) throw badRequest("The parent media's duration is unknown", 'ANCHOR_UNSUPPORTED')
    if (anchorStartMs > Math.round(duration * 1000)) {
      throw badRequest('Anchor is past the end of the parent media', 'INVALID_ANCHOR')
    }
    return anchorStartMs
  }

  private content(input: ContentInput) {
    const text = input.text?.trim() || null
    const mediaIds = input.mediaIds ?? []
    if (!text && mediaIds.length === 0) throw badRequest('Item needs text or media', 'EMPTY_ITEM')
    return { text, mediaIds }
  }

  private async createMessage(tx: Tx, authorId: string, content: { text: string | null; mediaIds: string[] }) {
    const message = await tx.message.create({ data: { authorId, text: content.text }, select: { id: true } })
    if (content.mediaIds.length > 0) {
      const uniqueMediaIds = Array.from(new Set(content.mediaIds))
      const medias = await tx.media.findMany({ where: { id: { in: uniqueMediaIds }, ownerId: authorId, messageId: null } })
      if (medias.length !== uniqueMediaIds.length) throw badRequest('Media not found or already attached', 'INVALID_MEDIA')
      
      for (const [position, id] of content.mediaIds.entries()) {
        await tx.media.update({ where: { id }, data: { messageId: message.id, position } })
      }
    }
    return { id: message.id }
  }

  // Row lock on the room serializes numbering within a room.
  private async place(tx: Tx, p: { roomId: string; messageId: string; parentId: string | null; anchorStartMs?: number | null }) {
    const { itemCount } = await tx.room.update({
      where: { id: p.roomId },
      data: { itemCount: { increment: 1 }, lastActivityAt: new Date() },
      select: { itemCount: true },
    })
    const item = await tx.item.create({
      data: { roomId: p.roomId, messageId: p.messageId, number: itemCount, parentId: p.parentId, anchorStartMs: p.anchorStartMs ?? null },
      include: itemInclude,
    })
    await recountRooms(tx, [p.roomId])
    return item
  }

  private publishCreated(viewerId: string, item: Prisma.ItemGetPayload<{ include: typeof itemInclude }>) {
    streamHub.publish(item.roomId, { type: 'item.created', actorId: viewerId, itemId: item.id, itemNumber: item.number })
    return toItem(item, viewerId)
  }

  private async anyVisible(viewerId: string, roomIds: string[]) {
    const uniqueIds = Array.from(new Set(roomIds))
    const visibleRoom = await db.room.findFirst({
      where: {
        id: { in: uniqueIds },
        deletedAt: null,
        OR: [{ visibility: 'public' }, { members: { some: { userId: viewerId } } }],
      },
      select: { id: true }
    })
    return visibleRoom !== null
  }
}
