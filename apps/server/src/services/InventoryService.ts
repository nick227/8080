// Inventory = what the workspace sells; Interest = a contact's link to an item.
// Reuses the broad CRM record verbs (record.read / record.write / record.delete).
import { db, Prisma, type RecordStatus } from '@project/db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
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
  async list(userId: string, workspaceId: string, opts: { q?: string; category?: string; status?: RecordStatus; cursor?: string; limit?: number }) {
    await authorize(userId, workspaceId, 'record.read')
    const limit = normalizeLimit(opts.limit)
    const cursor = decodeKeyCursor<{ n: string; id: string }>(opts.cursor)
    const q = opts.q?.trim()
    const where: Prisma.InventoryWhereInput = {
      workspaceId,
      status: opts.status ?? 'active',
      ...(opts.category ? { category: opts.category } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { sku: { startsWith: q } }] } : {}),
    }
    if (cursor) {
      if (typeof cursor.n !== 'string' || typeof cursor.id !== 'string') throw badRequest('Invalid cursor')
      where.AND = [{ OR: [{ name: { gt: cursor.n } }, { name: cursor.n, id: { gt: cursor.id } }] }]
    }
    const rows = await db.inventory.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: limit + 1 })
    const result = page(rows, limit, (last) => encodeKeyCursor({ n: last.name, id: last.id }))
    return { data: result.data.map(toInventoryItem), meta: result.meta }
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

  async update(userId: string, workspaceId: string, inventoryId: string, input: InventoryInput) {
    await authorize(userId, workspaceId, 'record.write')
    await liveItem(workspaceId, inventoryId)
    if ('name' in input && !blank(input.name)) throw badRequest('An item needs a name', 'EMPTY_ITEM')
    assertValid(input)
    try {
      const updated = await db.inventory.update({
        where: { id: inventoryId },
        data: {
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
      return toInventoryItem(updated)
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
