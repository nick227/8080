// Inventory = what the workspace sells; Interest = a contact's link to an item.
// Reuses the broad CRM record verbs (record.read / record.write / record.delete).
import { db, Prisma, type RecordStatus } from '@project/db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { toContactRef } from '../lib/serialize'
import { authorize } from './workspacePolicy'

export type InventoryInput = {
  name?: string
  sku?: string | null
  description?: string | null
  price?: number
  category?: string | null
  status?: RecordStatus
  quantity?: number | null
  availability?: boolean
  imageUrl?: string | null
}

const blank = (s: string | null | undefined) => (s?.trim() ? s.trim() : null)

export const toInventoryItem = (i: {
  id: string
  workspaceId: string
  name: string
  sku: string | null
  description: string | null
  price: number
  category: string | null
  status: RecordStatus
  quantity: number | null
  availability: boolean
  imageUrl: string | null
  version: number
  createdAt: Date
  updatedAt: Date
}) => ({
  id: i.id,
  workspaceId: i.workspaceId,
  name: i.name,
  sku: i.sku,
  description: i.description,
  price: i.price,
  category: i.category,
  status: i.status,
  quantity: i.quantity,
  availability: i.availability,
  imageUrl: i.imageUrl,
  version: i.version,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
})

function assertValid(input: InventoryInput) {
  if (input.price !== undefined && (!Number.isFinite(input.price) || input.price < 0)) throw badRequest('Price must be zero or more', 'INVALID_PRICE')
  if (input.quantity !== undefined && input.quantity !== null && (!Number.isInteger(input.quantity) || input.quantity < 0)) {
    throw badRequest('Quantity must be a whole number, zero or more', 'INVALID_QUANTITY')
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

// A SKU repeats only by mistake; surface it as a conflict instead of a raw DB error.
function skuConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw conflict('Another item already uses that code', 'SKU_TAKEN')
  throw err
}

export class InventoryService {
  async list(
    userId: string,
    workspaceId: string,
    opts: {
      q?: string
      category?: string
      status?: RecordStatus
      focus?: 'offered' | 'paused' | 'out'
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
    if (opts.focus && !['offered', 'paused', 'out'].includes(opts.focus)) throw badRequest('Unknown inventory focus', 'INVALID_FOCUS')
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
        ? [{ price: tip }, { id: tip }]
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
        v: sort === 'price' || sort === 'quantity' ? last[sort] : sort === 'updated' ? last.updatedAt.toISOString() : last.name,
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
    const [all, offered, paused, outOfStock, archived] = await Promise.all([
      db.inventory.count({ where: active }),
      db.inventory.count({ where: { ...active, availability: true } }),
      db.inventory.count({ where: { ...active, availability: false } }),
      db.inventory.count({ where: { ...active, quantity: 0 } }),
      db.inventory.count({ where: { ...base, status: 'archived' } }),
    ])
    return { data: { all, offered, paused, outOfStock, archived } }
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
    opts: { q?: string; category?: string; status?: RecordStatus; focus?: 'offered' | 'paused' | 'out' },
  ): Prisma.InventoryWhereInput {
    const q = opts.q?.trim()
    return {
      workspaceId,
      status: opts.status ?? 'active',
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.focus === 'offered' ? { availability: true } : {}),
      ...(opts.focus === 'paused' ? { availability: false } : {}),
      ...(opts.focus === 'out' ? { quantity: 0 } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { sku: { startsWith: q } }] } : {}),
    }
  }

  private cursorClause(
    sort: 'name' | 'price' | 'updated' | 'quantity',
    dir: 'asc' | 'desc',
    cursor: { v: string | number | null; id: string },
  ): Prisma.InventoryWhereInput {
    const gt = dir === 'asc'
    const field = sort === 'price' ? 'price' : sort === 'updated' ? 'updatedAt' : sort === 'quantity' ? 'quantity' : 'name'
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
    await authorize(userId, workspaceId, 'record.write')
    const name = blank(input.name)
    if (!name) throw badRequest('An item needs a name', 'EMPTY_ITEM')
    assertValid(input)
    try {
      const created = await db.inventory.create({
        data: {
          workspaceId,
          name: name.slice(0, 160),
          sku: blank(input.sku),
          description: blank(input.description),
          price: input.price ?? 0,
          category: blank(input.category),
          status: input.status ?? 'active',
          // null quantity = a service / catalog entry with no stock count
          quantity: input.quantity ?? null,
          availability: input.availability ?? true,
          imageUrl: blank(input.imageUrl),
        },
      })
      return toInventoryItem(created)
    } catch (err) {
      skuConflict(err)
    }
  }

  // Optimistic concurrency: one atomic statement updates the item only if it is still
  // at the version the caller read, and bumps the version. Anything else is a 409 —
  // never a silent overwrite of someone's newer change.
  async update(userId: string, workspaceId: string, inventoryId: string, input: InventoryInput & { expectedVersion: number }) {
    await authorize(userId, workspaceId, 'record.write')
    await liveItem(workspaceId, inventoryId)
    if ('name' in input && !blank(input.name)) throw badRequest('An item needs a name', 'EMPTY_ITEM')
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw badRequest('expectedVersion is required', 'INVALID_VERSION')
    assertValid(input)
    try {
      const claimed = await db.inventory.updateMany({
        where: { id: inventoryId, workspaceId, version: input.expectedVersion },
        data: {
          version: { increment: 1 },
          name: 'name' in input ? blank(input.name)!.slice(0, 160) : undefined,
          sku: 'sku' in input ? blank(input.sku) : undefined,
          description: 'description' in input ? blank(input.description) : undefined,
          price: input.price,
          category: 'category' in input ? blank(input.category) : undefined,
          status: input.status,
          quantity: 'quantity' in input ? (input.quantity ?? null) : undefined,
          availability: input.availability,
          imageUrl: 'imageUrl' in input ? blank(input.imageUrl) : undefined,
        },
      })
      if (!claimed.count) throw conflict('This item changed since you opened it; reload it before saving', 'INVENTORY_VERSION_CONFLICT')
      return toInventoryItem(await liveItem(workspaceId, inventoryId))
    } catch (err) {
      skuConflict(err)
    }
  }

  async remove(userId: string, workspaceId: string, inventoryId: string) {
    await authorize(userId, workspaceId, 'record.delete')
    await liveItem(workspaceId, inventoryId)
    await db.inventory.delete({ where: { id: inventoryId } })
  }

  // ─── interests: Contact ↔ Interest ↔ Item ──────────────────────────────────

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
    // Idempotent: adding the same interest twice returns the existing one.
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
