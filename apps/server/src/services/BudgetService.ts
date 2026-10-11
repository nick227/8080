import {
  db,
  Prisma,
  type BudgetCategory,
  type BudgetDirection,
  type BudgetRecurrence,
  type BudgetStatus,
} from '@project/db'
import { badRequest, notFound } from '../lib/errors'
import { authorize } from './workspacePolicy'

export type CreateBudgetItemInput = {
  title: string
  description?: string | null
  direction: BudgetDirection
  category: BudgetCategory
  amountMinor: number
  currency?: string
  status?: BudgetStatus
  scheduledDate: string
  scheduledTime?: string | null
  clearedAt?: string | null
  recurring?: BudgetRecurrence | null
  contactId?: string | null
  taskId?: string | null
  inventoryId?: string | null
  blueprintSlug?: string | null
  blueprintHorizon?: string | null
  isBlueprintBase?: boolean
}

export type UpdateBudgetItemInput = Partial<CreateBudgetItemInput> & {
  expectedVersion?: number
}

export type ListBudgetQuery = {
  direction?: BudgetDirection
  category?: BudgetCategory
  status?: BudgetStatus
  scheduledDate?: string
  from?: string
  to?: string
  search?: string
  sort?: 'date' | 'amount' | 'title' | 'created'
  dir?: 'asc' | 'desc'
  limit?: number | string
  offset?: number | string
}

export class BudgetService {
  async list(userId: string, workspaceId: string, query: ListBudgetQuery = {}) {
    await authorize(userId, workspaceId, 'budget.read')

    const where: Prisma.BudgetItemWhereInput = {
      workspaceId,
      deletedAt: null,
    }

    if (query.direction) where.direction = query.direction
    if (query.category) where.category = query.category
    if (query.status) where.status = query.status
    if (query.scheduledDate) where.scheduledDate = query.scheduledDate

    if (query.from || query.to) {
      where.scheduledDate = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      }
    }

    if (query.search?.trim()) {
      const q = query.search.trim()
      where.OR = [
        { title: { contains: q } },
        { description: { contains: q } },
      ]
    }

    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)
    const offset = Math.max(Number(query.offset) || 0, 0)

    let orderBy: Prisma.BudgetItemOrderByWithRelationInput = { scheduledDate: 'asc' }
    const dir = query.dir === 'desc' ? 'desc' : 'asc'
    if (query.sort === 'amount') orderBy = { amountMinor: dir }
    else if (query.sort === 'title') orderBy = { title: dir }
    else if (query.sort === 'created') orderBy = { createdAt: dir }
    else orderBy = { scheduledDate: dir }

    const [items, total] = await Promise.all([
      db.budgetItem.findMany({
        where,
        orderBy: [orderBy, { id: 'asc' }],
        take: limit,
        skip: offset,
        include: {
          contact: { select: { id: true, displayName: true } },
          task: { select: { id: true, taskKey: true, title: true } },
          inventory: { select: { id: true, name: true, sku: true } },
        },
      }),
      db.budgetItem.count({ where }),
    ])

    return { data: items, total, limit, offset }
  }

  async getSummary(userId: string, workspaceId: string) {
    const actor = await authorize(userId, workspaceId, 'budget.read')
    const currency = actor.workspace.defaultCurrency || 'USD'

    const rows = await db.budgetItem.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        status: { not: 'cancelled' },
      },
      select: {
        direction: true,
        category: true,
        status: true,
        amountMinor: true,
      },
    })

    let totalIncomeMinor = 0
    let totalExpenseMinor = 0
    let plannedIncomeMinor = 0
    let plannedExpenseMinor = 0
    let clearedIncomeMinor = 0
    let clearedExpenseMinor = 0
    let pendingIncomeMinor = 0
    let pendingExpenseMinor = 0

    const incomeByCategory: Record<string, number> = {}
    const expenseByCategory: Record<string, number> = {}

    for (const r of rows) {
      if (r.direction === 'income') {
        totalIncomeMinor += r.amountMinor
        incomeByCategory[r.category] = (incomeByCategory[r.category] || 0) + r.amountMinor
        if (r.status === 'planned') plannedIncomeMinor += r.amountMinor
        else if (r.status === 'cleared') clearedIncomeMinor += r.amountMinor
        else if (r.status === 'pending') pendingIncomeMinor += r.amountMinor
      } else {
        totalExpenseMinor += r.amountMinor
        expenseByCategory[r.category] = (expenseByCategory[r.category] || 0) + r.amountMinor
        if (r.status === 'planned') plannedExpenseMinor += r.amountMinor
        else if (r.status === 'cleared') clearedExpenseMinor += r.amountMinor
        else if (r.status === 'pending') pendingExpenseMinor += r.amountMinor
      }
    }

    const netBalanceMinor = totalIncomeMinor - totalExpenseMinor
    const clearedNetMinor = clearedIncomeMinor - clearedExpenseMinor

    return {
      currency,
      totalIncomeMinor,
      totalExpenseMinor,
      netBalanceMinor,
      clearedNetMinor,
      plannedIncomeMinor,
      plannedExpenseMinor,
      clearedIncomeMinor,
      clearedExpenseMinor,
      pendingIncomeMinor,
      pendingExpenseMinor,
      incomeByCategory,
      expenseByCategory,
      itemCount: rows.length,
    }
  }

  async create(userId: string, workspaceId: string, input: CreateBudgetItemInput) {
    const actor = await authorize(userId, workspaceId, 'budget.write')

    if (!input.title?.trim()) throw badRequest('Budget title is required')
    if (!input.scheduledDate?.trim()) throw badRequest('Scheduled date is required')
    if (typeof input.amountMinor !== 'number' || input.amountMinor < 0) {
      throw badRequest('Amount in minor units must be a non-negative integer')
    }

    return db.budgetItem.create({
      data: {
        workspaceId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        direction: input.direction,
        category: input.category,
        amountMinor: Math.round(input.amountMinor),
        currency: input.currency?.toUpperCase() || actor.workspace.defaultCurrency || 'USD',
        status: input.status || 'planned',
        scheduledDate: input.scheduledDate.trim(),
        scheduledTime: input.scheduledTime?.trim() || null,
        clearedAt: input.clearedAt ? new Date(input.clearedAt) : null,
        recurring: input.recurring || 'none',
        contactId: input.contactId || null,
        taskId: input.taskId || null,
        inventoryId: input.inventoryId || null,
        authorMemberId: actor.member.id,
        blueprintSlug: input.blueprintSlug?.trim() || null,
        blueprintHorizon: input.blueprintHorizon?.trim() || null,
        isBlueprintBase: Boolean(input.isBlueprintBase),
      },
      include: {
        contact: { select: { id: true, displayName: true } },
        task: { select: { id: true, taskKey: true, title: true } },
        inventory: { select: { id: true, name: true, sku: true } },
      },
    })
  }

  async get(userId: string, workspaceId: string, budgetItemId: string) {
    await authorize(userId, workspaceId, 'budget.read')

    const item = await db.budgetItem.findFirst({
      where: { id: budgetItemId, workspaceId, deletedAt: null },
      include: {
        contact: { select: { id: true, displayName: true } },
        task: { select: { id: true, taskKey: true, title: true } },
        inventory: { select: { id: true, name: true, sku: true } },
      },
    })
    if (!item) throw notFound('Budget item not found')
    return item
  }

  async update(userId: string, workspaceId: string, budgetItemId: string, input: UpdateBudgetItemInput) {
    await authorize(userId, workspaceId, 'budget.write')

    const existing = await db.budgetItem.findFirst({
      where: { id: budgetItemId, workspaceId, deletedAt: null },
    })
    if (!existing) throw notFound('Budget item not found')

    const data: Prisma.BudgetItemUpdateInput = {
      version: { increment: 1 },
    }

    if (input.title !== undefined) {
      if (!input.title?.trim()) throw badRequest('Title cannot be blank')
      data.title = input.title.trim()
    }
    if (input.description !== undefined) data.description = input.description?.trim() || null
    if (input.direction !== undefined) data.direction = input.direction
    if (input.category !== undefined) data.category = input.category
    if (input.amountMinor !== undefined) {
      if (typeof input.amountMinor !== 'number' || input.amountMinor < 0) {
        throw badRequest('Amount must be a non-negative integer')
      }
      data.amountMinor = Math.round(input.amountMinor)
    }
    if (input.currency !== undefined) data.currency = input.currency.toUpperCase()
    if (input.status !== undefined) {
      data.status = input.status
      if (input.status === 'cleared' && !existing.clearedAt && !input.clearedAt) {
        data.clearedAt = new Date()
      }
    }
    if (input.scheduledDate !== undefined) data.scheduledDate = input.scheduledDate.trim()
    if (input.scheduledTime !== undefined) data.scheduledTime = input.scheduledTime?.trim() || null
    if (input.clearedAt !== undefined) data.clearedAt = input.clearedAt ? new Date(input.clearedAt) : null
    if (input.recurring !== undefined) data.recurring = input.recurring
    if (input.contactId !== undefined) data.contact = input.contactId ? { connect: { id: input.contactId } } : { disconnect: true }
    if (input.taskId !== undefined) data.task = input.taskId ? { connect: { id: input.taskId } } : { disconnect: true }
    if (input.inventoryId !== undefined) data.inventory = input.inventoryId ? { connect: { id: input.inventoryId } } : { disconnect: true }

    return db.budgetItem.update({
      where: { id: budgetItemId },
      data,
      include: {
        contact: { select: { id: true, displayName: true } },
        task: { select: { id: true, taskKey: true, title: true } },
        inventory: { select: { id: true, name: true, sku: true } },
      },
    })
  }

  async remove(userId: string, workspaceId: string, budgetItemId: string) {
    const actor = await authorize(userId, workspaceId, 'budget.read')
    const existing = await db.budgetItem.findFirst({
      where: { id: budgetItemId, workspaceId, deletedAt: null },
      select: { id: true, authorMemberId: true },
    })
    if (!existing) throw notFound('Budget item not found')

    await authorize(userId, workspaceId, 'budget.delete', {
      kind: 'budget',
      authorMemberId: existing.authorMemberId,
    })

    await db.budgetItem.update({
      where: { id: budgetItemId },
      data: { deletedAt: new Date() },
    })
  }
}

export const budgetService = new BudgetService()
