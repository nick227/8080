// Thin Company vocabulary: pipeline stages and inventory categories.
import { db, Prisma } from '@project/db'
import { DEFAULT_INVENTORY_CATEGORIES } from '@project/shared'
import { badRequest, conflict } from '../lib/errors'
import { runAction } from './actions'
import { contactFieldDefinitions } from './contactWorkbench'
import { pipelineService } from './PipelineService'
import { ensureContactCategories } from './TagService'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize } from './workspacePolicy'

const nameOf = (raw: string, label = 'Category') => {
  const name = raw.trim()
  if (!name) throw badRequest(`${label} required`, 'INVALID_CATEGORY')
  if (name.length > 80) throw badRequest(`${label} too long`, 'INVALID_CATEGORY')
  return name
}

export async function ensureInventoryCategories(client: Prisma.TransactionClient | typeof db, workspaceId: string) {
  for (const name of DEFAULT_INVENTORY_CATEGORIES) {
    await client.inventoryCategory.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      create: { workspaceId, name },
      update: {},
    })
  }
  const used = await client.inventory.findMany({
    where: { workspaceId, category: { not: null } },
    distinct: ['category'],
    select: { category: true },
  })
  for (const row of used) {
    const name = row.category?.trim()
    if (!name) continue
    await client.inventoryCategory.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      create: { workspaceId, name },
      update: {},
    })
  }
}

async function listCategories(workspaceId: string, tx: Prisma.TransactionClient | typeof db = db) {
  await ensureInventoryCategories(tx, workspaceId)
  const rows = await tx.inventoryCategory.findMany({
    where: { workspaceId },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 100,
  })
  return rows.map((r) => r.name)
}

export class VocabularyService {
  async get(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'companyProfile.read')
    await ensureContactCategories(db, workspaceId)
    const [stages, categories] = await Promise.all([
      pipelineService.list(userId, workspaceId, { includeArchived: true }),
      listCategories(workspaceId),
    ])
    return { stages, categories, fields: [] }
  }

  async createCategory(ctx: WorkspaceCtx, workspaceId: string, input: { name: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'companyProfile.edit')
    const name = nameOf(input.name)
    return runAction(
      {
        action: 'vocabulary.createCategory',
        workspaceId,
        actor: memberActor(actor),
        origin: ctx.origin,
        input: { name },
        target: { type: 'vocabulary', id: workspaceId },
      },
      async (tx) => {
        try {
          await tx.inventoryCategory.create({ data: { workspaceId, name } })
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw conflict('That category already exists', 'CATEGORY_EXISTS')
          }
          throw err
        }
        return { value: { name } }
      },
    )
  }

  async renameCategory(ctx: WorkspaceCtx, workspaceId: string, input: { from: string; to: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'companyProfile.edit')
    const from = nameOf(input.from, 'Current category')
    const to = input.to.trim()
    if (to.length > 80) throw badRequest('Category too long', 'INVALID_CATEGORY')
    return runAction(
      {
        action: 'vocabulary.renameCategory',
        workspaceId,
        actor: memberActor(actor),
        origin: ctx.origin,
        input: { from, to },
        target: { type: 'vocabulary', id: workspaceId },
      },
      async (tx) => {
        if (!to) {
          await tx.inventory.updateMany({ where: { workspaceId, category: from }, data: { category: null } })
          await tx.inventoryCategory.deleteMany({ where: { workspaceId, name: from } })
          return { value: { from, to: null as string | null } }
        }
        if (to !== from) {
          const clash = await tx.inventoryCategory.findUnique({ where: { workspaceId_name: { workspaceId, name: to } } })
          if (clash) throw conflict('That category already exists', 'CATEGORY_EXISTS')
          await tx.inventory.updateMany({ where: { workspaceId, category: from }, data: { category: to } })
          const existing = await tx.inventoryCategory.findUnique({ where: { workspaceId_name: { workspaceId, name: from } } })
          if (existing) {
            await tx.inventoryCategory.update({ where: { id: existing.id }, data: { name: to } })
          } else {
            await tx.inventoryCategory.create({ data: { workspaceId, name: to } })
          }
        }
        return { value: { from, to: to as string | null } }
      },
    )
  }

  async removeCategory(ctx: WorkspaceCtx, workspaceId: string, input: { name: string }) {
    return this.renameCategory(ctx, workspaceId, { from: input.name, to: '' })
  }

  async updateFields(
    ctx: WorkspaceCtx,
    workspaceId: string,
    input: { fields: { key: string; label: string; position?: number }[] },
  ) {
    const actor = await authorize(ctx.user.id, workspaceId, 'companyProfile.edit')
    const defs = await contactFieldDefinitions(workspaceId)
    const byKey = new Map(defs.map((d) => [d.key, d]))
    for (const f of input.fields) {
      if (!byKey.has(f.key)) throw badRequest(`Unknown field ${f.key}`, 'INVALID_FIELD')
      if (!f.label.trim() || f.label.length > 80) throw badRequest('Invalid field label', 'INVALID_LABEL')
    }
    return runAction(
      {
        action: 'vocabulary.updateFields',
        workspaceId,
        actor: memberActor(actor),
        origin: ctx.origin,
        input,
        target: { type: 'vocabulary', id: workspaceId },
      },
      async (tx) => {
        for (const f of input.fields) {
          const base = byKey.get(f.key)!
          await tx.contactFieldDefinition.upsert({
            where: { workspaceId_key: { workspaceId, key: f.key } },
            create: {
              workspaceId,
              key: f.key,
              label: f.label.trim(),
              type: base.type,
              options: base.options,
              position: f.position ?? base.position,
              archived: false,
            },
            update: {
              label: f.label.trim(),
              ...(f.position !== undefined ? { position: f.position } : {}),
            },
          })
        }
        return { value: await contactFieldDefinitions(workspaceId) }
      },
    )
  }
}

export const vocabularyService = new VocabularyService()
