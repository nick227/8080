// Checklist lines inside a task. Every change is a runAction with a history line on
// the task (so its timeline, live boards and open panels follow) and bumps the
// task's version (so a stale snapshot can't hide the new progress).
import { db, Prisma } from '@project/db'
import { badRequest, notFound } from '../lib/errors'
import { toAuthor } from '../lib/serialize'
import { runAction } from './actions'
import { authorize } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'

type Tx = Prisma.TransactionClient

const MAX_ITEMS = 100
const STEP = 1024

const itemInclude = { doneBy: { include: { user: { include: { profile: true } } } } } satisfies Prisma.WorkChecklistItemInclude
type ItemRow = Prisma.WorkChecklistItemGetPayload<{ include: typeof itemInclude }>

export function toChecklistItem(i: ItemRow) {
  return {
    id: i.id,
    taskId: i.taskId,
    text: i.text,
    done: i.done,
    position: i.position,
    doneAt: i.doneAt,
    doneByName: i.doneBy ? toAuthor(i.doneBy.user).name : null,
    createdAt: i.createdAt,
  }
}

type Placement = { afterItemId?: string | null; beforeItemId?: string | null }

async function liveTask(workspaceId: string, taskId: string) {
  const task = await db.workTask.findFirst({ where: { id: taskId, workspaceId, deletedAt: null }, select: { id: true, taskKey: true, title: true } })
  if (!task) throw notFound('Task not found')
  return task
}

/** Position between neighbours in this task's list (renumbers when the gap runs out). */
async function positionFor(tx: Tx, taskId: string, place: Placement, movingId?: string): Promise<number> {
  const at = async (id: string | null | undefined) => {
    if (!id || id === movingId) return null
    const row = await tx.workChecklistItem.findFirst({ where: { id, taskId }, select: { position: true } })
    if (!row) throw badRequest('That checklist item is not on this task', 'INVALID_POSITION')
    return row.position
  }
  const above = await at(place.afterItemId)
  const below = await at(place.beforeItemId)
  if (above === null && below === null) {
    const last = await tx.workChecklistItem.findFirst({ where: { taskId, id: movingId ? { not: movingId } : undefined }, orderBy: { position: 'desc' }, select: { position: true } })
    return (last?.position ?? 0) + STEP
  }
  // One neighbour given: the other is whatever sits next to it now.
  const others = { taskId, id: movingId ? { not: movingId } : undefined }
  if (above !== null && below === null) {
    const next = await tx.workChecklistItem.findFirst({ where: { ...others, position: { gt: above } }, orderBy: { position: 'asc' }, select: { position: true } })
    if (!next) return above + STEP
    return between(tx, taskId, place, above, next.position, movingId)
  }
  if (above === null) {
    const prev = await tx.workChecklistItem.findFirst({ where: { ...others, position: { lt: below! } }, orderBy: { position: 'desc' }, select: { position: true } })
    if (!prev) return below! - STEP
    return between(tx, taskId, place, prev.position, below!, movingId)
  }
  return between(tx, taskId, place, above, below!, movingId)
}

async function between(tx: Tx, taskId: string, place: Placement, above: number, below: number, movingId?: string): Promise<number> {
  if (below - above > 1e-6) return (above + below) / 2
  const rows = await tx.workChecklistItem.findMany({ where: { taskId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true } })
  for (const [i, r] of rows.entries()) await tx.workChecklistItem.update({ where: { id: r.id }, data: { position: (i + 1) * STEP } })
  return positionFor(tx, taskId, place, movingId)
}

const bump = (tx: Tx, taskId: string) => tx.workTask.update({ where: { id: taskId }, data: { version: { increment: 1 } } })

export class ChecklistService {
  async list(userId: string, workspaceId: string, taskId: string) {
    await authorize(userId, workspaceId, 'task.read')
    await liveTask(workspaceId, taskId)
    const rows = await db.workChecklistItem.findMany({ where: { taskId }, include: itemInclude, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
    return { data: rows.map(toChecklistItem) }
  }

  async add(ctx: WorkspaceCtx, workspaceId: string, taskId: string, input: { text: string } & Placement) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    const task = await liveTask(workspaceId, taskId)
    const text = input.text?.trim()
    if (!text) throw badRequest('Write the step first', 'INVALID_TEXT')
    if ((await db.workChecklistItem.count({ where: { taskId } })) >= MAX_ITEMS) throw badRequest(`A checklist holds at most ${MAX_ITEMS} items; split the work into subtasks`, 'CHECKLIST_FULL')
    return runAction(
      { action: 'task.checklist.add', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { taskId, text }, target: { type: 'task', id: taskId } },
      async (tx) => {
        const created = await tx.workChecklistItem.create({
          data: { workspaceId, taskId, text: text.slice(0, 500), position: await positionFor(tx, taskId, input) },
          include: itemInclude,
        })
        await bump(tx, taskId)
        return { value: toChecklistItem(created), activities: [{ type: 'task.checklist.added', object: { taskId }, summary: { taskId, taskKey: task.taskKey, title: task.title, text: created.text } }] }
      },
    )
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, taskId: string, itemId: string, input: { text?: string; done?: boolean } & Placement) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    const task = await liveTask(workspaceId, taskId)
    const before = await db.workChecklistItem.findFirst({ where: { id: itemId, taskId, workspaceId } })
    if (!before) throw notFound('Checklist item not found')
    const text = input.text?.trim()
    if (input.text !== undefined && !text) throw badRequest('A checklist item needs text', 'INVALID_TEXT')
    const moving = 'afterItemId' in input || 'beforeItemId' in input
    return runAction(
      { action: 'task.checklist.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { taskId, itemId, ...input }, target: { type: 'task', id: taskId } },
      async (tx) => {
        const done = input.done ?? before.done
        const after = await tx.workChecklistItem.update({
          where: { id: itemId },
          data: {
            text: text?.slice(0, 500),
            done: input.done,
            ...(done !== before.done ? { doneAt: done ? new Date() : null, doneByMemberId: done ? actor.member.id : null } : {}),
            position: moving ? await positionFor(tx, taskId, input, itemId) : undefined,
          },
          include: itemInclude,
        })
        await bump(tx, taskId)
        const summary = { taskId, taskKey: task.taskKey, title: task.title, text: after.text }
        const activities = []
        if (done !== before.done) activities.push({ type: 'task.checklist.checked', object: { taskId }, summary: { ...summary, done } })
        if (text && text !== before.text) activities.push({ type: 'task.checklist.edited', object: { taskId }, summary: { ...summary, previous: before.text } })
        if (moving && !activities.length) activities.push({ type: 'task.checklist.moved', object: { taskId }, summary })
        return { value: toChecklistItem(after), activities }
      },
    )
  }

  async remove(ctx: WorkspaceCtx, workspaceId: string, taskId: string, itemId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    const task = await liveTask(workspaceId, taskId)
    const item = await db.workChecklistItem.findFirst({ where: { id: itemId, taskId, workspaceId } })
    if (!item) throw notFound('Checklist item not found')
    await runAction(
      { action: 'task.checklist.remove', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { taskId, itemId }, target: { type: 'task', id: taskId } },
      async (tx) => {
        await tx.workChecklistItem.delete({ where: { id: itemId } })
        await bump(tx, taskId)
        return { value: null, activities: [{ type: 'task.checklist.removed', object: { taskId }, summary: { taskId, taskKey: task.taskKey, title: task.title, text: item.text } }] }
      },
    )
  }
}
