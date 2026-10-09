// Workspace tasks: one shared list behind the Calendar (scheduled day/time) and
// the Boards (status columns ordered by `rank`). Every write is a runAction.
// Deleting is soft so the board can offer Undo (restore).
import { db, Prisma } from '@project/db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { toAuthor } from '../lib/serialize'
import { runAction, diff, type ActivityDraft } from './actions'
import { authorize, permit, type Actor } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'

type Tx = Prisma.TransactionClient

export const TASK_STATUSES = ['open', 'in_progress', 'in_review', 'done'] as const
export const TASK_TYPES = ['task', 'feature', 'bug', 'story', 'epic'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'highest'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

const KEY_PREFIX = 'VC'
const RANK_STEP = 1024
// Below this gap two neighbours can't be split reliably: renumber the column.
const RANK_EPSILON = 1e-6
const IMPORT_MAX = 500

export type TaskInput = {
  title?: string
  description?: string | null
  status?: TaskStatus
  issueType?: (typeof TASK_TYPES)[number]
  area?: string | null
  priority?: (typeof TASK_PRIORITIES)[number]
  storyPoints?: number | null
  scheduledDate?: string | null
  scheduledTime?: string | null
  dueDate?: string | null
  assigneeMemberId?: string | null
  source?: string | null
}

// Where a card lands in its column: between the card above (`afterTaskId`) and
// the card below (`beforeTaskId`). Neither = bottom of the column.
export type Placement = { afterTaskId?: string | null; beforeTaskId?: string | null }

const taskInclude = {
  assignee: { include: { user: { include: { profile: true } } } },
  _count: { select: { comments: true } },
} satisfies Prisma.WorkTaskInclude
type TaskRow = Prisma.WorkTaskGetPayload<{ include: typeof taskInclude }>

const blank = (s: string | null | undefined) => (s?.trim() ? s.trim() : null)
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

export function toTask(t: TaskRow) {
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    taskKey: t.taskKey,
    number: t.taskNumber,
    title: t.title,
    description: t.description,
    status: t.status as TaskStatus,
    issueType: t.issueType,
    area: t.area,
    priority: t.priority,
    storyPoints: t.storyPoints,
    scheduledDate: t.scheduledDate,
    scheduledTime: t.scheduledTime,
    dueDate: dateOnly(t.dueDate),
    assigneeMemberId: t.assigneeMemberId,
    assignee: t.assignee ? { memberId: t.assignee.id, ...pick(toAuthor(t.assignee.user)) } : null,
    createdByMemberId: t.createdByMemberId,
    rank: t.rank,
    version: t.version,
    commentCount: t._count.comments,
    source: t.source,
    resolvedAt: t.resolvedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}
const pick = (a: { name: string; avatarUrl: string | null }) => ({ name: a.name, avatarUrl: a.avatarUrl })

const DAY = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

function assertValid(input: TaskInput) {
  if (input.title !== undefined && !input.title.trim()) throw badRequest('A task needs a title', 'INVALID_TITLE')
  if (input.scheduledDate && !validDay(input.scheduledDate)) throw badRequest('Scheduled date must be YYYY-MM-DD', 'INVALID_DATE')
  if (input.dueDate && !validDay(input.dueDate)) throw badRequest('Due date must be YYYY-MM-DD', 'INVALID_DATE')
  if (input.scheduledTime && !CLOCK.test(input.scheduledTime)) throw badRequest('Time must be HH:MM', 'INVALID_TIME')
  if (input.scheduledTime && !input.scheduledDate && input.scheduledDate !== undefined) throw badRequest('A time needs a date', 'INVALID_TIME')
}

function validDay(day: string) {
  if (!DAY.test(day)) return false
  const d = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day
}

async function assertAssignee(workspaceId: string, memberId: string | null | undefined) {
  if (!memberId) return
  const member = await db.workspaceMember.findFirst({ where: { id: memberId, workspaceId, status: 'active' }, select: { id: true } })
  if (!member) throw badRequest('Assignee must be an active member of this workspace', 'INVALID_ASSIGNEE')
}

async function liveTask(client: Tx | typeof db, workspaceId: string, taskId: string) {
  const task = await client.workTask.findFirst({ where: { id: taskId, workspaceId, deletedAt: null }, include: taskInclude })
  if (!task) throw notFound('Task not found')
  return task
}

/** Rank for a card placed in `status` between the given neighbours (renumbers the column if needed). */
async function rankFor(tx: Tx, workspaceId: string, status: string, place: Placement, movingId?: string): Promise<number> {
  const neighbour = async (id: string | null | undefined) => {
    if (!id || id === movingId) return null
    const row = await tx.workTask.findFirst({ where: { id, workspaceId, status, deletedAt: null }, select: { rank: true } })
    if (!row) throw badRequest('The neighbouring card is not in that column', 'INVALID_POSITION')
    return row.rank
  }
  const above = await neighbour(place.afterTaskId)
  const below = await neighbour(place.beforeTaskId)
  if (above === null && below === null) {
    const last = await tx.workTask.findFirst({ where: { workspaceId, status, deletedAt: null, id: movingId ? { not: movingId } : undefined }, orderBy: { rank: 'desc' }, select: { rank: true } })
    return (last?.rank ?? 0) + RANK_STEP
  }
  if (above === null) return below! - RANK_STEP
  if (below === null) return above + RANK_STEP
  if (below - above > RANK_EPSILON) return (above + below) / 2
  await renumber(tx, workspaceId, status)
  return rankFor(tx, workspaceId, status, place, movingId)
}

async function renumber(tx: Tx, workspaceId: string, status: string) {
  const rows = await tx.workTask.findMany({ where: { workspaceId, status, deletedAt: null }, orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }], select: { id: true } })
  for (const [i, row] of rows.entries()) await tx.workTask.update({ where: { id: row.id }, data: { rank: (i + 1) * RANK_STEP } })
}

async function nextNumber(tx: Tx, workspaceId: string) {
  const top = await tx.workTask.aggregate({ where: { workspaceId }, _max: { taskNumber: true } })
  return Math.max(top._max.taskNumber ?? 100, 100) + 1
}

const isNumberRace = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && /taskNumber|taskKey/.test(String(err.meta?.target ?? ''))

// Two creates can read the same max number; the unique index refuses one and it retries.
async function withNumberRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt < 4 && isNumberRace(err)) continue
      throw err
    }
  }
}

function createData(workspaceId: string, number: number, rank: number, actor: Actor, input: TaskInput) {
  const status = input.status ?? 'open'
  return {
    workspaceId,
    taskNumber: number,
    taskKey: `${KEY_PREFIX}-${number}`,
    title: input.title!.trim().slice(0, 255),
    description: blank(input.description),
    status,
    issueType: input.issueType ?? 'task',
    area: blank(input.area),
    priority: input.priority ?? 'medium',
    storyPoints: input.storyPoints ?? null,
    scheduledDate: input.scheduledDate || null,
    scheduledTime: input.scheduledDate ? input.scheduledTime || null : null,
    dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
    assigneeMemberId: input.assigneeMemberId ?? null,
    createdByMemberId: actor.member.id,
    source: blank(input.source)?.slice(0, 64) ?? null,
    rank,
    resolvedAt: status === 'done' ? new Date() : null,
  }
}

const statusChange = (before: string, after: string) => (before === after ? {} : { resolvedAt: after === 'done' ? new Date() : null })

const TRACKED = ['title', 'description', 'status', 'issueType', 'area', 'priority', 'storyPoints', 'scheduledDate', 'scheduledTime', 'dueDate', 'assigneeMemberId'] as const

function activitiesFor(before: TaskRow, after: TaskRow): ActivityDraft[] {
  const summary = { taskId: after.id, taskKey: after.taskKey, title: after.title }
  const out: ActivityDraft[] = []
  if (before.status !== after.status) out.push({ type: 'task.moved', summary: { ...summary, from: before.status, to: after.status } })
  if (before.assigneeMemberId !== after.assigneeMemberId) out.push({ type: 'task.assigned', summary: { ...summary, from: before.assigneeMemberId, to: after.assigneeMemberId } })
  return out
}

export class TaskService {
  async list(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'task.read')
    const rows = await db.workTask.findMany({
      where: { workspaceId, deletedAt: null },
      include: taskInclude,
      orderBy: [{ status: 'asc' }, { rank: 'asc' }, { createdAt: 'asc' }],
    })
    return { data: rows.map(toTask) }
  }

  async get(userId: string, workspaceId: string, taskId: string) {
    await authorize(userId, workspaceId, 'task.read')
    return toTask(await liveTask(db, workspaceId, taskId))
  }

  async create(ctx: WorkspaceCtx, workspaceId: string, input: TaskInput & Placement) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    if (input.title === undefined) throw badRequest('A task needs a title', 'INVALID_TITLE')
    assertValid(input)
    await assertAssignee(workspaceId, input.assigneeMemberId)
    return withNumberRetry(() =>
      runAction(
        { action: 'task.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { ...input }, target: { type: 'task' } },
        async (tx) => {
          const status = input.status ?? 'open'
          const rank = await rankFor(tx, workspaceId, status, input)
          const created = await tx.workTask.create({ data: createData(workspaceId, await nextNumber(tx, workspaceId), rank, actor, input), include: taskInclude })
          const value = toTask(created)
          return {
            value,
            targetId: created.id,
            activities: [{ type: 'task.created', summary: { taskId: created.id, taskKey: created.taskKey, title: created.title, status } }],
          }
        },
      ),
    )
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, taskId: string, input: TaskInput & { expectedVersion?: number }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    assertValid(input)
    const before = await liveTask(db, workspaceId, taskId)
    if ('assigneeMemberId' in input) await assertAssignee(workspaceId, input.assigneeMemberId)
    const scheduledDate = 'scheduledDate' in input ? input.scheduledDate || null : before.scheduledDate
    if ('scheduledTime' in input && input.scheduledTime && !scheduledDate) throw badRequest('A time needs a date', 'INVALID_TIME')
    return runAction(
      { action: 'task.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { taskId, ...input }, target: { type: 'task', id: taskId } },
      async (tx) => {
        const claimed = await tx.workTask.updateMany({
          where: { id: taskId, workspaceId, deletedAt: null, version: input.expectedVersion ?? before.version },
          data: { version: { increment: 1 } },
        })
        if (!claimed.count) throw conflict('Task changed; reload it before saving again', 'TASK_VERSION_CONFLICT')
        const status = input.status ?? before.status
        await tx.workTask.update({
          where: { id: taskId },
          data: {
            title: input.title?.trim().slice(0, 255),
            description: 'description' in input ? blank(input.description) : undefined,
            status: input.status,
            // A status change through the editor lands at the bottom of the new column.
            rank: status !== before.status ? await rankFor(tx, workspaceId, status, {}, taskId) : undefined,
            ...statusChange(before.status, status),
            issueType: input.issueType,
            area: 'area' in input ? blank(input.area) : undefined,
            priority: input.priority,
            storyPoints: 'storyPoints' in input ? input.storyPoints : undefined,
            scheduledDate: 'scheduledDate' in input ? scheduledDate : undefined,
            // Clearing the date clears the time with it.
            scheduledTime: !scheduledDate ? null : 'scheduledTime' in input ? input.scheduledTime || null : undefined,
            dueDate: 'dueDate' in input ? (input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null) : undefined,
            assigneeMemberId: 'assigneeMemberId' in input ? input.assigneeMemberId ?? null : undefined,
          },
        })
        const after = await liveTask(tx, workspaceId, taskId)
        return { value: toTask(after), changes: diff(before, after, TRACKED), activities: activitiesFor(before, after) }
      },
    )
  }

  /** Board move: a new status and/or position in the column. Last write wins (no version). */
  async move(ctx: WorkspaceCtx, workspaceId: string, taskId: string, input: Placement & { status: TaskStatus }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    const before = await liveTask(db, workspaceId, taskId)
    if (input.afterTaskId && input.afterTaskId === input.beforeTaskId) throw badRequest('A card cannot sit on both sides of itself', 'INVALID_POSITION')
    return runAction(
      { action: 'task.move', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { taskId, ...input }, target: { type: 'task', id: taskId } },
      async (tx) => {
        const rank = await rankFor(tx, workspaceId, input.status, input, taskId)
        await tx.workTask.update({
          where: { id: taskId },
          data: { status: input.status, rank, version: { increment: 1 }, ...statusChange(before.status, input.status) },
        })
        const after = await liveTask(tx, workspaceId, taskId)
        return { value: toTask(after), changes: diff(before, after, ['status', 'rank'] as const), activities: activitiesFor(before, after) }
      },
    )
  }

  async remove(ctx: WorkspaceCtx, workspaceId: string, taskId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.read')
    const task = await liveTask(db, workspaceId, taskId)
    permit(actor, 'task.delete')
    await runAction(
      { action: 'task.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'task', id: taskId } },
      async (tx) => {
        await tx.workTask.update({ where: { id: taskId }, data: { deletedAt: new Date(), version: { increment: 1 } } })
        return { value: null, activities: [{ type: 'task.deleted', summary: { taskId, taskKey: task.taskKey, title: task.title } }] }
      },
    )
  }

  /** Undo a delete: the card returns to its old column and position. */
  async restore(ctx: WorkspaceCtx, workspaceId: string, taskId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.delete')
    const task = await db.workTask.findFirst({ where: { id: taskId, workspaceId }, select: { deletedAt: true } })
    if (!task) throw notFound('Task not found')
    return runAction(
      { action: 'task.restore', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'task', id: taskId } },
      async (tx) => {
        const restored = await tx.workTask.update({ where: { id: taskId }, data: { deletedAt: null, version: { increment: 1 } }, include: taskInclude })
        const activities = task.deletedAt ? [{ type: 'task.restored', summary: { taskId, taskKey: restored.taskKey, title: restored.title } }] : []
        return { value: toTask(restored), activities }
      },
    )
  }

  /** Many tasks at once (CSV import, adopting tasks saved in a browser). Idempotent with a key. */
  async import(ctx: WorkspaceCtx, workspaceId: string, input: { tasks: TaskInput[]; idempotencyKey?: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    if (!input.tasks.length) return { data: [] }
    if (input.tasks.length > IMPORT_MAX) throw badRequest(`At most ${IMPORT_MAX} tasks per import`, 'TOO_MANY_TASKS')
    for (const row of input.tasks) {
      if (row.title === undefined) throw badRequest('Every task needs a title', 'INVALID_TITLE')
      assertValid(row)
    }
    // Assignees that aren't active members are dropped, not refused: imported data is loose.
    const memberIds = new Set(
      (await db.workspaceMember.findMany({ where: { workspaceId, status: 'active' }, select: { id: true } })).map((m) => m.id),
    )
    const rows = input.tasks.map((t) => ({ ...t, assigneeMemberId: t.assigneeMemberId && memberIds.has(t.assigneeMemberId) ? t.assigneeMemberId : null }))
    const load = async (ids: string[]) => {
      const found = await db.workTask.findMany({ where: { id: { in: ids }, workspaceId }, include: taskInclude, orderBy: { taskNumber: 'asc' } })
      return { data: found.map(toTask) }
    }
    return withNumberRetry(() =>
      runAction(
        { action: 'task.import', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { count: rows.length, tasks: rows }, idempotencyKey: input.idempotencyKey, target: { type: 'task' } },
        async (tx) => {
          let number = await nextNumber(tx, workspaceId)
          const ids: string[] = []
          for (const row of rows) {
            const rank = await rankFor(tx, workspaceId, row.status ?? 'open', {})
            const created = await tx.workTask.create({ data: createData(workspaceId, number++, rank, actor, row), select: { id: true } })
            ids.push(created.id)
          }
          const value = await (async () => {
            const found = await tx.workTask.findMany({ where: { id: { in: ids } }, include: taskInclude, orderBy: { taskNumber: 'asc' } })
            return { data: found.map(toTask) }
          })()
          return { value, result: { taskIds: ids }, activities: [{ type: 'task.imported', summary: { count: ids.length } }] }
        },
        async (previous) => load(((previous.result as { taskIds?: string[] } | null)?.taskIds ?? [])),
      ),
    )
  }

  async listComments(userId: string, workspaceId: string, taskId: string) {
    await authorize(userId, workspaceId, 'task.read')
    await liveTask(db, workspaceId, taskId)
    const rows = await db.workComment.findMany({
      where: { taskId },
      include: { author: { include: { user: { include: { profile: true } } } } },
      orderBy: { createdAt: 'asc' },
    })
    return { data: rows.map(toComment) }
  }

  async addComment(ctx: WorkspaceCtx, workspaceId: string, taskId: string, input: { text: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    const text = input.text.trim()
    if (!text) throw badRequest('Write something first', 'INVALID_COMMENT')
    const task = await liveTask(db, workspaceId, taskId)
    return runAction(
      { action: 'task.comment', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { taskId, text }, target: { type: 'task', id: taskId } },
      async (tx) => {
        const created = await tx.workComment.create({
          data: { taskId, authorMemberId: actor.member.id, authorName: (await authorName(tx, actor)).slice(0, 120), text },
          include: { author: { include: { user: { include: { profile: true } } } } },
        })
        return { value: toComment(created), activities: [{ type: 'task.commented', summary: { taskId, taskKey: task.taskKey, title: task.title } }] }
      },
    )
  }
}

async function authorName(tx: Tx, actor: Actor) {
  const profile = await tx.profile.findUnique({ where: { userId: actor.member.userId }, select: { displayName: true } })
  return profile?.displayName ?? 'Member'
}

type CommentRow = Prisma.WorkCommentGetPayload<{ include: { author: { include: { user: { include: { profile: true } } } } } }>

function toComment(c: CommentRow) {
  const author = c.author ? toAuthor(c.author.user) : null
  return {
    id: c.id,
    taskId: c.taskId,
    authorMemberId: c.authorMemberId,
    authorName: author?.name ?? c.authorName,
    authorAvatarUrl: author?.avatarUrl ?? null,
    text: c.text,
    createdAt: c.createdAt,
  }
}
