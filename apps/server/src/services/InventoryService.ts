// Inventory = what the workspace sells; Interest = a contact's link to an item.
// Stock movements are append-only quantity history (adjust / edit / import) — not a ledger.
import { db, Prisma, type RecordStatus } from '@project/db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { toContactRef } from '../lib/serialize'
import { fromMinor, toMinor } from '../lib/money'
import { authorize } from './workspacePolicy'
import { RecordImageService } from './RecordImageService'

export type InventoryInput = {
  name?: string
  sku?: string | null
  description?: string | null
  price?: number
  category?: string | null
  status?: RecordStatus
  quantity?: number | null
  lowStockThreshold?: number | null
  location?: string | null
  availability?: boolean
}

type InventoryRow = {
  id: string
  workspaceId: string
  name: string
  sku: string | null
  description: string | null
  priceMinor: number
  currency: string
  category: string | null
  status: RecordStatus
  quantity: number | null
  lowStockThreshold: number | null
  lowStock: boolean
  location: string | null
  availability: boolean
  imageUrl: string | null
  version: number
  createdAt: Date
  updatedAt: Date
}

const blank = (s: string | null | undefined) => (s?.trim() ? s.trim() : null)

export const isLowStock = (quantity: number | null, threshold: number | null) =>
  quantity != null && threshold != null && quantity > 0 && quantity <= threshold

export const toInventoryItem = (i: InventoryRow) => ({
  id: i.id,
  workspaceId: i.workspaceId,
  name: i.name,
  sku: i.sku,
  description: i.description,
  // Exact: priceMinor in currency. `price` is the same amount as a decimal.
  price: fromMinor(i.priceMinor, i.currency),
  priceMinor: i.priceMinor,
  currency: i.currency,
  category: i.category,
  status: i.status,
  quantity: i.quantity,
  lowStockThreshold: i.lowStockThreshold,
  lowStock: i.lowStock,
  location: i.location,
  availability: i.availability,
  imageUrl: i.imageUrl,
  version: i.version,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
})

/** A decimal price → exact minor units, or 400 if it has more decimals than the currency. */
export function exactPrice(price: number, currency: string) {
  const minor = toMinor(price, currency)
  if (minor === null) throw badRequest(`Price has more decimal places than ${currency} allows`, 'INVALID_PRICE')
  return minor
}

function assertValid(input: InventoryInput) {
  if (input.price !== undefined && (!Number.isFinite(input.price) || input.price < 0)) throw badRequest('Price must be zero or more', 'INVALID_PRICE')
  if (input.quantity !== undefined && input.quantity !== null && (!Number.isInteger(input.quantity) || input.quantity < 0)) {
    throw badRequest('Quantity must be a whole number, zero or more', 'INVALID_QUANTITY')
  }
  if (
    input.lowStockThreshold !== undefined &&
    input.lowStockThreshold !== null &&
    (!Number.isInteger(input.lowStockThreshold) || input.lowStockThreshold < 0)
  ) {
    throw badRequest('Low-stock threshold must be a whole number, zero or more', 'INVALID_THRESHOLD')
  }
}

async function liveItem(workspaceId: string, inventoryId: string) {
  const item = await db.inventory.findFirst({ where: { id: inventoryId, workspaceId } })
  if (!item) throw notFound('Item not found')
  return item
}

async function liveContact(workspaceId: string, contactId: string) {
  const contact = await db.contact.findFirst({ where: { id: contactId, workspaceId, deletedAt: null }, select: { id: true } })
  if (!contact) throw notFound('Contact not found')
}

function skuConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw conflict('Another item already uses that code', 'SKU_TAKEN')
  throw err
}

async function memberIdFor(userId: string, workspaceId: string) {
  return (await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } }))?.id ?? null
}

async function recordMovement(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string
    inventoryId: string
    fromQuantity: number | null
    toQuantity: number | null
    reason?: string | null
    source: 'adjust' | 'edit' | 'import'
    actorMemberId: string | null
  },
) {
  if (input.fromQuantity === input.toQuantity) return
  const delta =
    input.fromQuantity != null && input.toQuantity != null ? input.toQuantity - input.fromQuantity : null
  await tx.inventoryStockMovement.create({
    data: {
      workspaceId: input.workspaceId,
      inventoryId: input.inventoryId,
      fromQuantity: input.fromQuantity,
      toQuantity: input.toQuantity,
      delta,
      reason: blank(input.reason)?.slice(0, 240) ?? null,
      source: input.source,
      actorMemberId: input.actorMemberId,
    },
  })
}

export class InventoryService {
  async list(
    userId: string,
    workspaceId: string,
    opts: {
      q?: string
      category?: string
      status?: RecordStatus
      focus?: 'offered' | 'paused' | 'out' | 'low'
      sort?: 'name' | 'price' | 'updated' | 'quantity'
      dir?: 'asc' | 'desc'
      cursor?: string
      limit?: number
    },
  ) {
    await authorize(userId, workspaceId, 'record.read')
    const limit = normalizeLimit(opts.limit)
    const sort = opts.sort ?? 'name'
    const dir = opts.dir === 'desc' ? 'desc' : 'asc'
    if (opts.focus && !['offered', 'paused', 'out', 'low'].includes(opts.focus)) throw badRequest('Unknown inventory focus', 'INVALID_FOCUS')
    if (opts.sort && !['name', 'price', 'updated', 'quantity'].includes(opts.sort)) throw badRequest('Unknown sort', 'INVALID_SORT')
    const where = this.listWhere(workspaceId, opts)
    const cursor = decodeKeyCursor<{ v: string | number | null; id: string; sort: string; dir: string }>(opts.cursor)
    if (cursor) {
      if (cursor.sort !== sort || cursor.dir !== dir) throw badRequest('Invalid cursor')
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), this.cursorClause(sort, dir, cursor)]
    }
    const tip = dir === 'desc' ? ('desc' as const) : ('asc' as const)
    const orderBy: Prisma.InventoryOrderByWithRelationInput[] =
      sort === 'price'
        ? [{ priceMinor: tip }, { id: tip }]
        : sort === 'updated'
          ? [{ updatedAt: tip }, { id: tip }]
          : sort === 'quantity'
            ? [{ quantity: tip }, { id: tip }]
            : [{ name: tip }, { id: tip }]
    const [rows, total] = await Promise.all([
      db.inventory.findMany({ where, orderBy, take: limit + 1 }),
      db.inventory.count({ where: this.listWhere(workspaceId, opts) }),
    ])
    const result = page(rows, limit, (last) =>
      encodeKeyCursor({
        v: sort === 'price' ? last.priceMinor : sort === 'quantity' ? last.quantity : sort === 'updated' ? last.updatedAt.toISOString() : last.name,
        id: last.id,
        sort,
        dir,
      }),
    )
    return { data: result.data.map(toInventoryItem), meta: { ...result.meta, total } }
  }

  async counts(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'record.read')
    const base = { workspaceId }
    const active = { ...base, status: 'active' as const }
    const [all, offered, paused, outOfStock, low, archived] = await Promise.all([
      db.inventory.count({ where: active }),
      db.inventory.count({ where: { ...active, availability: true } }),
      db.inventory.count({ where: { ...active, availability: false } }),
      db.inventory.count({ where: { ...active, quantity: 0 } }),
      db.inventory.count({ where: { ...active, lowStock: true } }),
      db.inventory.count({ where: { ...base, status: 'archived' } }),
    ])
    return { data: { all, offered, paused, outOfStock, low, archived } }
  }

  async bulk(
    userId: string,
    workspaceId: string,
    input: { ids: string[]; action: 'archive' | 'restore' | 'setAvailability'; availability?: boolean },
  ) {
    await authorize(userId, workspaceId, 'record.write')
    const ids = [...new Set(input.ids.map((id) => id.trim()).filter(Boolean))]
    if (!ids.length) throw badRequest('Select at least one item', 'EMPTY_BULK')
    if (ids.length > 50) throw badRequest('At most 50 items at a time', 'BULK_TOO_LARGE')
    if (input.action === 'setAvailability' && typeof input.availability !== 'boolean')
      throw badRequest('Choose offered or paused', 'MISSING_AVAILABILITY')
    const data =
      input.action === 'archive'
        ? { status: 'archived' as const }
        : input.action === 'restore'
          ? { status: 'active' as const }
          : { availability: input.availability! }
    const result = await db.inventory.updateMany({
      where: { workspaceId, id: { in: ids } },
      data: { ...data, version: { increment: 1 } },
    })
    return { data: { updated: result.count } }
  }

  private listWhere(
    workspaceId: string,
    opts: { q?: string; category?: string; status?: RecordStatus; focus?: 'offered' | 'paused' | 'out' | 'low' },
  ): Prisma.InventoryWhereInput {
    const q = opts.q?.trim()
    return {
      workspaceId,
      status: opts.status ?? 'active',
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.focus === 'offered' ? { availability: true } : {}),
      ...(opts.focus === 'paused' ? { availability: false } : {}),
      ...(opts.focus === 'out' ? { quantity: 0 } : {}),
      ...(opts.focus === 'low' ? { lowStock: true } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { sku: { startsWith: q } }, { location: { contains: q } }] } : {}),
    }
  }

  private cursorClause(
    sort: 'name' | 'price' | 'updated' | 'quantity',
    dir: 'asc' | 'desc',
    cursor: { v: string | number | null; id: string },
  ): Prisma.InventoryWhereInput {
    const gt = dir === 'asc'
    const field = sort === 'price' ? 'priceMinor' : sort === 'updated' ? 'updatedAt' : sort === 'quantity' ? 'quantity' : 'name'
    if (cursor.v === null) {
      return {
        OR: [
          { [field]: null, id: gt ? { gt: cursor.id } : { lt: cursor.id } },
          ...(gt ? [] : [{ [field]: { not: null } }]),
        ],
      }
    }
    const value = sort === 'updated' ? new Date(String(cursor.v)) : cursor.v
    return {
      OR: [
        { [field]: gt ? { gt: value } : { lt: value } },
        { [field]: value, id: gt ? { gt: cursor.id } : { lt: cursor.id } },
      ],
    }
  }

  async get(userId: string, workspaceId: string, inventoryId: string) {
    await authorize(userId, workspaceId, 'record.read')
    return toInventoryItem(await liveItem(workspaceId, inventoryId))
  }

  async create(userId: string, workspaceId: string, input: InventoryInput) {
    const actor = await authorize(userId, workspaceId, 'record.write')
    const currency = actor.workspace.defaultCurrency
    const name = blank(input.name)
    if (!name) throw badRequest('An item needs a name', 'EMPTY_ITEM')
    assertValid(input)
    const priceMinor = exactPrice(input.price ?? 0, currency)
    const quantity = input.quantity ?? null
    const lowStockThreshold = quantity == null ? null : (input.lowStockThreshold ?? null)
    try {
      const created = await db.inventory.create({
        data: {
          workspaceId,
          name: name.slice(0, 160),
          sku: blank(input.sku),
          description: blank(input.description),
          priceMinor,
          currency,
          category: blank(input.category),
          status: input.status ?? 'active',
          quantity,
          lowStockThreshold,
          lowStock: isLowStock(quantity, lowStockThreshold),
          location: blank(input.location)?.slice(0, 120) ?? null,
          availability: input.availability ?? true,
        },
      })
      return toInventoryItem(created)
    } catch (err) {
      skuConflict(err)
    }
  }

  async update(userId: string, workspaceId: string, inventoryId: string, input: InventoryInput & { expectedVersion: number }) {
    await authorize(userId, workspaceId, 'record.write')
    const before = await liveItem(workspaceId, inventoryId)
    if ('name' in input && !blank(input.name)) throw badRequest('An item needs a name', 'EMPTY_ITEM')
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw badRequest('expectedVersion is required', 'INVALID_VERSION')
    assertValid(input)
    // A new price is in the item's own currency, exactly.
    const priceMinor = input.price === undefined ? undefined : exactPrice(input.price, before.currency)
    const nextQuantity = 'quantity' in input ? (input.quantity ?? null) : before.quantity
    const nextThreshold =
      nextQuantity == null
        ? null
        : 'lowStockThreshold' in input
          ? (input.lowStockThreshold ?? null)
          : before.lowStockThreshold
    const actorMemberId = await memberIdFor(userId, workspaceId)
    try {
      const updated = await db.$transaction(async (tx) => {
        const claimed = await tx.inventory.updateMany({
          where: { id: inventoryId, workspaceId, version: input.expectedVersion },
          data: {
            version: { increment: 1 },
            name: 'name' in input ? blank(input.name)!.slice(0, 160) : undefined,
            sku: 'sku' in input ? blank(input.sku) : undefined,
            description: 'description' in input ? blank(input.description) : undefined,
            priceMinor,
            category: 'category' in input ? blank(input.category) : undefined,
            status: input.status,
            quantity: 'quantity' in input ? nextQuantity : undefined,
            lowStockThreshold: 'quantity' in input || 'lowStockThreshold' in input ? nextThreshold : undefined,
            lowStock: 'quantity' in input || 'lowStockThreshold' in input ? isLowStock(nextQuantity, nextThreshold) : undefined,
            location: 'location' in input ? blank(input.location)?.slice(0, 120) ?? null : undefined,
            availability: input.availability,
          },
        })
        if (!claimed.count) throw conflict('This item changed since you opened it; reload it before saving', 'INVENTORY_VERSION_CONFLICT')
        if ('quantity' in input) {
          await recordMovement(tx, {
            workspaceId,
            inventoryId,
            fromQuantity: before.quantity,
            toQuantity: nextQuantity,
            source: 'edit',
            actorMemberId,
          })
        }
        return tx.inventory.findFirstOrThrow({ where: { id: inventoryId, workspaceId } })
      })
      return toInventoryItem(updated)
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'INVENTORY_VERSION_CONFLICT') throw err
      skuConflict(err)
    }
  }

  /** Focused stock set: records a movement with optional reason. */
  async adjustStock(
    userId: string,
    workspaceId: string,
    inventoryId: string,
    input: { expectedVersion: number; quantity: number; reason?: string | null },
  ) {
    await authorize(userId, workspaceId, 'record.write')
    const before = await liveItem(workspaceId, inventoryId)
    if (before.quantity == null) throw badRequest('This item does not track stock', 'STOCK_NOT_TRACKED')
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw badRequest('expectedVersion is required', 'INVALID_VERSION')
    if (!Number.isInteger(input.quantity) || input.quantity < 0) throw badRequest('Quantity must be a whole number, zero or more', 'INVALID_QUANTITY')
    const actorMemberId = await memberIdFor(userId, workspaceId)
    try {
      const updated = await db.$transaction(async (tx) => {
        const claimed = await tx.inventory.updateMany({
          where: { id: inventoryId, workspaceId, version: input.expectedVersion },
          data: {
            version: { increment: 1 },
            quantity: input.quantity,
            lowStock: isLowStock(input.quantity, before.lowStockThreshold),
          },
        })
        if (!claimed.count) throw conflict('This item changed since you opened it; reload it before saving', 'INVENTORY_VERSION_CONFLICT')
        await recordMovement(tx, {
          workspaceId,
          inventoryId,
          fromQuantity: before.quantity,
          toQuantity: input.quantity,
          reason: input.reason,
          source: 'adjust',
          actorMemberId,
        })
        return tx.inventory.findFirstOrThrow({ where: { id: inventoryId, workspaceId } })
      })
      return toInventoryItem(updated)
    } catch (err) {
      if (err && typeof err === 'object' && 'statusCode' in err) throw err
      throw err
    }
  }

  async listStockMovements(
    userId: string,
    workspaceId: string,
    inventoryId: string,
    opts: { cursor?: string; limit?: number },
  ) {
    await authorize(userId, workspaceId, 'record.read')
    await liveItem(workspaceId, inventoryId)
    const limit = normalizeLimit(opts.limit)
    const cursor = decodeKeyCursor<{ at: string; id: string }>(opts.cursor)
    const rows = await db.inventoryStockMovement.findMany({
      where: {
        workspaceId,
        inventoryId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.at) } },
                { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { actor: { include: { user: { include: { profile: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const result = page(rows, limit, (last) => encodeKeyCursor({ at: last.createdAt.toISOString(), id: last.id }))
    return {
      data: result.data.map((row) => ({
        id: row.id,
        inventoryId: row.inventoryId,
        fromQuantity: row.fromQuantity,
        toQuantity: row.toQuantity,
        delta: row.delta,
        reason: row.reason,
        source: row.source as 'adjust' | 'edit' | 'import',
        actor: row.actor
          ? { id: row.actor.id, name: row.actor.user.profile?.displayName ?? row.actor.user.email ?? 'Member' }
          : null,
        createdAt: row.createdAt,
      })),
      meta: result.meta,
    }
  }

  async remove(userId: string, workspaceId: string, inventoryId: string) {
    await authorize(userId, workspaceId, 'record.delete')
    await liveItem(workspaceId, inventoryId)
    const gallery = new RecordImageService()
    const mediaIds = await db.$transaction(async (tx) => {
      const ids = await gallery.purgeSubject(tx, workspaceId, 'inventory', inventoryId)
      await tx.inventory.delete({ where: { id: inventoryId } })
      return ids
    })
    for (const mediaId of mediaIds) await gallery.discardOrphanMedia(mediaId)
  }

  async listInterests(userId: string, workspaceId: string, contactId: string) {
    await authorize(userId, workspaceId, 'record.read')
    await liveContact(workspaceId, contactId)
    const rows = await db.interest.findMany({ where: { workspaceId, contactId }, include: { inventory: true }, orderBy: { createdAt: 'desc' } })
    return { data: rows.map((r) => ({ id: r.id, contactId: r.contactId, createdAt: r.createdAt, item: toInventoryItem(r.inventory) })) }
  }

  async listItemInterests(userId: string, workspaceId: string, inventoryId: string) {
    await authorize(userId, workspaceId, 'record.read')
    await liveItem(workspaceId, inventoryId)
    const rows = await db.interest.findMany({
      where: { workspaceId, inventoryId, contact: { deletedAt: null } },
      include: { contact: true },
      orderBy: { createdAt: 'desc' },
    })
    return {
      data: rows.map((row) => ({
        id: row.id,
        inventoryId: row.inventoryId,
        createdAt: row.createdAt,
        contact: toContactRef(row.contact),
      })),
    }
  }

  async addInterest(userId: string, workspaceId: string, contactId: string, inventoryId: string) {
    await authorize(userId, workspaceId, 'record.write')
    await liveContact(workspaceId, contactId)
    await liveItem(workspaceId, inventoryId)
    const row = await db.interest.upsert({
      where: { workspaceId_contactId_inventoryId: { workspaceId, contactId, inventoryId } },
      create: { workspaceId, contactId, inventoryId },
      update: {},
      include: { inventory: true },
    })
    return { id: row.id, contactId: row.contactId, createdAt: row.createdAt, item: toInventoryItem(row.inventory) }
  }

  async removeInterest(userId: string, workspaceId: string, contactId: string, inventoryId: string) {
    await authorize(userId, workspaceId, 'record.write')
    await db.interest.deleteMany({ where: { workspaceId, contactId, inventoryId } })
  }
}
