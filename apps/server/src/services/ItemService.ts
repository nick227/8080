import { db, type Prisma } from '@project/db'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { itemInclude, toItem, type ItemRow } from '../lib/serialize'
import { badRequest, forbidden, notFound } from '../lib/errors'
import { humanAuthoredWhere } from '../lib/authorship'
import { BOT_LIMITS } from '../bots/limits'
import { RoomService, type Actor } from './RoomService'
import { recordChange } from './roomChanges'
import { events } from './events'
import { purgeCapture } from './purgeCapture'
import { recountRooms } from './roomStats'
import { mutes } from './MuteService'

const rooms = new RoomService()

type ItemCursor = { n: number }
type Tx = Prisma.TransactionClient
type ContentInput = { text?: string; mediaIds?: string[]; chat?: boolean }
type Placed = Prisma.ItemGetPayload<{ include: typeof itemInclude }>

/** Server-internal options (never reachable from HTTP). */
export type InternalOpts = {
  /** Runs inside the placing transaction after the Item exists — e.g. claiming a
   *  bot once-key, so the claim and the post commit or roll back together. */
  onPlaced?: (tx: Tx, item: Placed) => Promise<void>
}

// Message = reusable content; Item = its placement in one room.
//   send  → new Message + first Item (top-level)
//   reply → new Message + child Item, always in the parent's room
//   share → new Items only, reusing the Message and its media
//   placeExisting → (server-internal, bots) a new Item for an existing Message
//
// Surface: `chat` alone decides chat vs stage; `parentId` is only the reply link.
// Neither is derived from the other (doc/08 I3).
export class ItemService {
  // Default ascending remains compatible; descending pages load recent history first.
  async list(viewerId: string, roomId: string, opts: { cursor?: string; limit?: number; after?: number; order?: 'asc' | 'desc' }) {
    await rooms.viewable(viewerId, roomId)
    const limit = normalizeLimit(opts.limit)
    const c = decodeKeyCursor<ItemCursor>(opts.cursor)
    if (c && !Number.isInteger(c.n)) throw { statusCode: 400, message: 'Invalid cursor' }
    const descending = opts.order === 'desc'
    const floor = Math.max(opts.after ?? 0, descending ? 0 : c?.n ?? 0)

    const muted = await mutes.mutedBy(viewerId)
    return db.$transaction(async (tx) => {
      const room = await tx.room.findUniqueOrThrow({ where: { id: roomId }, select: { changeCount: true } })
      const rows = await tx.item.findMany({
        where: { roomId, number: { gt: floor, ...(descending && c ? { lt: c.n } : {}) } },
        orderBy: { number: descending ? 'desc' : 'asc' }, take: limit + 1, include: itemInclude,
      })
      const result = page(rows, limit, (last) => encodeKeyCursor<ItemCursor>({ n: last.number }))
      return { data: result.data.map((i) => toItem(i, viewerId, muted)), meta: { ...result.meta, changeCursor: String(room.changeCount) } }
    }, { isolationLevel: 'RepeatableRead' })
  }



  async get(viewerId: string, itemId: string) {
    const item = await this.loadViewable(viewerId, itemId)
    return toItem(item, viewerId, await mutes.mutedBy(viewerId))
  }

  async send(viewerId: string, roomId: string, input: ContentInput, opts: InternalOpts = {}) {
    const content = this.content(input)
    const { actor, room } = await rooms.authorizeActor(viewerId, roomId)
    await rooms.ensureHumanParticipation(actor, room)

    const placed = await db.$transaction(async (tx) => {
      await this.botCap(tx, actor, roomId)
      const msg = await this.createMessage(tx, viewerId, content)
      const result = await this.place(tx, actor, { roomId, messageId: msg.id, parentId: null, chat: input.chat === true })
      await opts.onPlaced?.(tx, result.item)
      return result
    })
    return this.publishCreated(actor, placed, room.ownerId)
  }

  async reply(viewerId: string, parentItemId: string, input: ContentInput & { anchorStartMs?: number }, opts: InternalOpts = {}) {
    const content = this.content(input)
    const chat = input.chat === true
    if (chat && input.anchorStartMs !== undefined) throw badRequest('Anchors are a stage feature; a chat reply cannot carry one', 'ANCHOR_UNSUPPORTED')
    // The room comes from the parent — a reply can never land in another room.
    const parent = await this.loadItem(parentItemId)
    const { actor, room } = await rooms.authorizeActor(viewerId, parent.roomId)
    const anchorStartMs = input.anchorStartMs === undefined ? null : this.anchor(parent, input.anchorStartMs)
    await rooms.ensureHumanParticipation(actor, room)

    const placed = await db.$transaction(async (tx) => {
      await this.botCap(tx, actor, parent.roomId)
      const msg = await this.createMessage(tx, viewerId, content)
      const result = await this.place(tx, actor, { roomId: parent.roomId, messageId: msg.id, parentId: parent.id, anchorStartMs, chat })
      await opts.onPlaced?.(tx, result.item)
      return result
    })
    return this.publishCreated(actor, placed, room.ownerId)
  }

  // Server-internal (bots): a NEW Item for an existing Message the actor authored —
  // a library asset staged again. No idempotency skip: an asset and its occurrences
  // are different things, and repeats are a policy question (doc/08 I2). The public
  // share endpoint keeps its own skip-if-present rule.
  async placeExisting(actorId: string, roomId: string, messageId: string, input: { chat?: boolean; parentId?: string | null }, opts: InternalOpts = {}) {
    const { actor, room } = await rooms.authorizeActor(actorId, roomId)
    const message = await db.message.findFirst({ where: { id: messageId, deletedAt: null }, select: { authorId: true } })
    if (!message) throw notFound('Message not found')
    if (message.authorId !== actorId) throw forbidden('Only the author can place this message')
    let parentId: string | null = null
    if (input.parentId) {
      const parent = await this.loadItem(input.parentId)
      if (parent.roomId !== roomId) throw badRequest('Parent is in another room', 'INVALID_PARENT')
      parentId = parent.id
    }
    await rooms.ensureHumanParticipation(actor, room)

    const placed = await db.$transaction(async (tx) => {
      await this.botCap(tx, actor, roomId)
      const result = await this.place(tx, actor, { roomId, messageId, parentId, chat: input.chat === true })
      await opts.onPlaced?.(tx, result.item)
      return result
    })
    return this.publishCreated(actor, placed, room.ownerId)
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
    
    // A person sharing into a public room they aren't in implicitly joins it.
    const actor = await rooms.actor(viewerId)
    await Promise.all(targets.map((room) => rooms.ensureHumanParticipation(actor, room)))

    const created = await db.$transaction(async (tx) => {
      const placed: Awaited<ReturnType<ItemService['place']>>[] = []
      for (const room of targets) placed.push(await this.place(tx, actor, { roomId: room.id, messageId, parentId: null }))
      return placed
    })
    return created.map((placed, i) => this.publishCreated(actor, placed, targets[i]!.ownerId))
  }

  // The author permanently removes the capture (file, media row, text) from every
  // room it was shared to. The placement row stays so replies keep their parent.
  async delete(viewerId: string, itemId: string) {
    const item = await this.loadItem(itemId)
    await rooms.authorizeActor(viewerId, item.roomId)
    if (item.message.authorId !== viewerId) throw forbidden('Only the author can delete this item')

    await purgeCapture(item.messageId, item.message.media)

    const updated = await db.item.findUniqueOrThrow({ where: { id: itemId }, include: itemInclude })
    return toItem(updated, viewerId)
  }

  async loadViewable(viewerId: string, itemId: string, extra?: Prisma.ItemWhereInput) {
    const item = await this.loadItem(itemId, extra)
    await rooms.viewable(viewerId, item.roomId) // 404s for private rooms the viewer can't see
    return item
  }

  // Unauthorized load — callers must authorize (authorizeActor / viewable) themselves.
  async loadItem(itemId: string, extra?: Prisma.ItemWhereInput) {
    const item = await db.item.findFirst({ where: { id: itemId, ...extra }, include: itemInclude })
    if (!item) throw notFound('Item not found')
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

  // Row lock on the room serializes numbering within a room. Only human items move
  // the lobby (lastActivityAt) — doc/08 I6.
  private async place(tx: Tx, actor: Actor, p: { roomId: string; messageId: string; parentId: string | null; anchorStartMs?: number | null; chat?: boolean }) {
    const human = actor.kind !== 'bot'
    const { itemCount } = await tx.room.update({
      where: { id: p.roomId },
      data: { itemCount: { increment: 1 }, ...(human ? { lastActivityAt: new Date() } : {}) },
      select: { itemCount: true },
    })
    const item = await tx.item.create({
      data: { roomId: p.roomId, messageId: p.messageId, number: itemCount, parentId: p.parentId, anchorStartMs: p.anchorStartMs ?? null, chat: p.chat === true },
      include: itemInclude,
    })
    const humanItems = (await recountRooms(tx, [p.roomId])).get(p.roomId) ?? 0
    await recordChange(tx, p.roomId, item.id, actor.id, 'item.created')
    return { item, firstHumanItem: human && humanItems === 1 }
  }

  // Authoritative room cap for bot posts (doc/08 §4.1). MUST be the transaction's
  // first statement: the room row lock comes first, and the counts that follow are
  // the transaction's first consistent reads, so InnoDB's snapshot is taken after
  // every earlier bot post in this room has committed. (Any read before the lock —
  // e.g. Prisma's SELECT after an INSERT — would freeze a stale snapshot and let
  // concurrent bots overshoot.)
  private async botCap(tx: Tx, actor: Actor, roomId: string) {
    if (actor.kind !== 'bot') return
    await tx.$queryRaw`SELECT id FROM Room WHERE id = ${roomId} FOR UPDATE`
    const since = new Date(Date.now() - BOT_LIMITS.roomCapWindowMs)
    const recent = await tx.item.count({ where: { roomId, deletedAt: null, createdAt: { gte: since }, NOT: humanAuthoredWhere } })
    if (recent >= BOT_LIMITS.roomCap) throw { statusCode: 429, message: 'Room bot cap reached', code: 'BOT_CAP' }
    const last = await tx.item.findMany({
      where: { roomId, deletedAt: null },
      orderBy: { number: 'desc' },
      take: BOT_LIMITS.maxConsecutive,
      select: { message: { select: { author: { select: { kind: true } } } } },
    })
    if (last.length >= BOT_LIMITS.maxConsecutive && last.every((i) => i.message.author.kind === 'bot')) {
      throw { statusCode: 429, message: 'Too many bot items in a row', code: 'BOT_CAP' }
    }
  }

  private publishCreated(actor: Actor, placed: { item: Placed; firstHumanItem: boolean }, roomOwnerId: string) {
    const { item } = placed
    events.emit('item.created', {
      roomId: item.roomId,
      itemId: item.id,
      itemNumber: item.number,
      actorId: actor.id,
      actorKind: actor.kind,
      chat: item.chat,
      parentId: item.parentId,
      text: item.deletedAt ? null : item.message.text,
      roomOwnerId,
      firstHumanItem: placed.firstHumanItem,
    })
    return toItem(item, actor.id)
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
