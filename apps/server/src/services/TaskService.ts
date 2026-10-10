// Workspace tasks: one shared list behind the Calendar (scheduled day/time) and
// the Boards (status columns ordered by `rank`). Every write is a runAction.
// Deleting is soft so the board can offer Undo (restore).
import { db, Prisma } from '@project/db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { activityInclude, toActivity, toAuthor } from '../lib/serialize'
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

export const taskInclude = {
  assignee: { include: { user: { include: { profile: true } } } },
  blockedBy: { include: { user: { include: { profile: true } } } },
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
    blocked: t.blockedAt
      ? { since: t.blockedAt, reason: t.blockedReason ?? '', byMemberId: t.blockedByMemberId, byName: t.blockedBy ? toAuthor(t.blockedBy.user).name : null }
      : null,
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

// Transactions that renumbered a column: their action records it, so live boards
// (whose ranks for those cards are now stale) reconcile.
const renumbered = new WeakSet<Tx>()
const renumberActivity = (tx: Tx, status: string): ActivityDraft[] => (renumbered.has(tx) ? [{ type: 'task.column.renumbered', summary: { status } }] : [])

async function renumber(tx: Tx, workspaceId: string, status: string) {
  renumbered.add(tx)
  const rows = await tx.workTask.findMany({ where: { workspaceId, status, deletedAt: null }, orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }], select: { id: true } })
  for (const [i, row] of rows.entries()) await tx.workTask.update({ where: { id: row.id }, data: { rank: (i + 1) * RANK_STEP, version: { increment: 1 } } })
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

const nameOf = (m: TaskRow['assignee']) => (m ? toAuthor(m.user).name : null)
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

// Field edits worth a line in the history. Description shows as "changed", not its text.
const EDITED = ['title', 'description', 'issueType', 'area', 'priority', 'storyPoints', 'scheduledDate', 'scheduledTime', 'dueDate'] as const

/** History lines for one change (every task activity carries taskId: the task's timeline). */
function activitiesFor(before: TaskRow, after: TaskRow): ActivityDraft[] {
  const object = { taskId: after.id }
  const summary = { taskId: after.id, taskKey: after.taskKey, title: after.title }
  const out: ActivityDraft[] = []
  if (before.status !== after.status) out.push({ type: 'task.moved', object, summary: { ...summary, from: before.status, to: after.status } })
  if (before.assigneeMemberId !== after.assigneeMemberId) {
    out.push({ type: 'task.assigned', object, summary: { ...summary, from: before.assigneeMemberId, to: after.assigneeMemberId, fromName: nameOf(before.assignee), toName: nameOf(after.assignee) } })
  }
  const changes: Record<string, [unknown, unknown]> = {}
  for (const field of EDITED) {
    const was = field === 'dueDate' ? iso(before.dueDate) : before[field]
    const now = field === 'dueDate' ? iso(after.dueDate) : after[field]
    if (was !== now) changes[field] = field === 'description' ? [null, null] : [was ?? null, now ?? null]
  }
  if (Object.keys(changes).length) out.push({ type: 'task.updated', object, summary: { ...summary, changes } })
  return out
}

/** Members named with @ in a comment: "@Ana" or "@Ana Lopez" (longest name wins). */
export function mentionedIn(text: string, members: { id: string; name: string }[]) {
  const lower = ` ${text.toLowerCase()}`
  const found = new Set<string>()
  const byLength = [...members].filter((m) => m.name.trim()).sort((x, y) => y.name.length - x.name.length)
  const firsts = new Map<string, number>()
  for (const m of byLength) {
    const first = m.name.trim().toLowerCase().split(/\s+/)[0]!
    firsts.set(first, (firsts.get(first) ?? 0) + 1)
  }
  for (const m of byLength) {
    const full = m.name.trim().toLowerCase()
    const first = full.split(/\s+/)[0]!
    // A first name alone only counts when nobody else shares it.
    for (const token of firsts.get(first) === 1 ? [full, first] : [full]) {
      const re = new RegExp(`(^|[^\\w@])@${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`)
      if (re.test(lower)) { found.add(m.id); break }
    }
  }
  return [...found]
}

/** The row changes for an edit (one task; shared by update and bulk). A status change lands at the bottom of the new column. */
async function patchData(tx: Tx, workspaceId: string, before: TaskRow, input: TaskInput) {
  const status = input.status ?? before.status
  const scheduledDate = 'scheduledDate' in input ? input.scheduledDate || null : before.scheduledDate
  return {
    title: input.title?.trim().slice(0, 255),
    description: 'description' in input ? blank(input.description) : undefined,
    status: input.status,
    rank: status !== before.status ? await rankFor(tx, workspaceId, status, {}, before.id) : undefined,
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
  }
}

const BULK_MAX = 200

/** Fields a bulk edit may set on many tasks at once. `blocked`: a reason blocks, null unblocks. */
export type BulkPatch = Pick<TaskInput, 'status' | 'priority' | 'issueType' | 'area' | 'storyPoints' | 'dueDate' | 'scheduledDate' | 'assigneeMemberId'> & {
  blocked?: { reason: string } | null
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
            activities: [...renumberActivity(tx, status), {
              type: 'task.created',
              object: { taskId: created.id },
              summary: { taskId: created.id, taskKey: created.taskKey, title: created.title, status, assigneeMemberId: created.assigneeMemberId, assigneeName: nameOf(created.assignee) },
            }],
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
        await tx.workTask.update({ where: { id: taskId }, data: await patchData(tx, workspaceId, before, input) })
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
        return { value: toTask(after), changes: diff(before, after, ['status', 'rank'] as const), activities: [...renumberActivity(tx, input.status), ...activitiesFor(before, after)] }
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
        return { value: null, activities: [{ type: 'task.deleted', object: { taskId }, summary: { taskId, taskKey: task.taskKey, title: task.title } }] }
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
        const activities = task.deletedAt ? [{ type: 'task.restored', object: { taskId }, summary: { taskId, taskKey: restored.taskKey, title: restored.title } }] : []
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

  /**
   * One change to many tasks, all or nothing: update (the same field logic as a
   * single edit), delete, or restore. Each task gets its own history line, so
   * notifications and live boards treat it like single edits.
   */
  async bulk(ctx: WorkspaceCtx, workspaceId: string, input: { ids: string[]; action: 'update' | 'delete' | 'restore'; patch?: BulkPatch; idempotencyKey?: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, input.action === 'update' ? 'task.write' : 'task.delete')
    const ids = [...new Set(input.ids)]
    if (!ids.length || ids.length > BULK_MAX) throw badRequest(`Choose between 1 and ${BULK_MAX} tasks`, 'INVALID_SELECTION')
    const patch = input.patch ?? {}
    if (input.action === 'update') {
      if (!Object.keys(patch).length) throw badRequest('Nothing to change', 'EMPTY_PATCH')
      assertValid(patch)
      if ('assigneeMemberId' in patch) await assertAssignee(workspaceId, patch.assigneeMemberId)
      if (patch.blocked && !patch.blocked.reason?.trim()) throw badRequest('Say what they are waiting on', 'INVALID_REASON')
    }
    const rows = await db.workTask.findMany({ where: { id: { in: ids }, workspaceId }, include: taskInclude, orderBy: [{ status: 'asc' }, { rank: 'asc' }] })
    const usable = rows.filter((t) => (input.action === 'restore' ? true : !t.deletedAt))
    if (usable.length !== ids.length) throw badRequest('Some of those tasks are not in this workspace (or were deleted)', 'INVALID_SELECTION')
    const load = async (taskIds: string[]) => ({
      data: (await db.workTask.findMany({ where: { id: { in: taskIds }, workspaceId, deletedAt: null }, include: taskInclude, orderBy: [{ status: 'asc' }, { rank: 'asc' }] })).map(toTask),
    })
    return runAction(
      { action: `task.bulk_${input.action}`, workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { ids, patch }, idempotencyKey: input.idempotencyKey, target: { type: 'task' } },
      async (tx) => {
        const activities: ActivityDraft[] = []
        const out: ReturnType<typeof toTask>[] = []
        // In board order, so cards moved together keep their order at the bottom of the new column.
        for (const before of usable) {
          const object = { taskId: before.id }
          const summary = { taskId: before.id, taskKey: before.taskKey, title: before.title }
          if (input.action === 'delete') {
            await tx.workTask.update({ where: { id: before.id }, data: { deletedAt: new Date(), version: { increment: 1 } } })
            activities.push({ type: 'task.deleted', object, summary })
            continue
          }
          if (input.action === 'restore') {
            if (!before.deletedAt) continue
            await tx.workTask.update({ where: { id: before.id }, data: { deletedAt: null, version: { increment: 1 } } })
            activities.push({ type: 'task.restored', object, summary })
            out.push(toTask(await liveTask(tx, workspaceId, before.id)))
            continue
          }
          const { blocked, ...fields } = patch
          const data: Record<string, unknown> = { ...(await patchData(tx, workspaceId, before, fields)), version: { increment: 1 } }
          if (blocked) Object.assign(data, { blockedAt: before.blockedAt ?? new Date(), blockedReason: blocked.reason.trim().slice(0, 280), blockedByMemberId: actor.member.id })
          if (blocked === null) Object.assign(data, { blockedAt: null, blockedReason: null, blockedByMemberId: null })
          await tx.workTask.update({ where: { id: before.id }, data })
          const after = await liveTask(tx, workspaceId, before.id)
          activities.push(...activitiesFor(before, after))
          if (blocked && after.blockedReason !== before.blockedReason) activities.push({ type: 'task.blocked', object, summary: { ...summary, reason: after.blockedReason, previous: before.blockedReason } })
          if (blocked === null && before.blockedAt) activities.push({ type: 'task.unblocked', object, summary: { ...summary, reason: before.blockedReason, blockedForMs: Date.now() - before.blockedAt.getTime() } })
          out.push(toTask(after))
        }
        return { value: { data: out }, result: { taskIds: ids }, activities }
      },
      async (previous) => load((previous.result as { taskIds?: string[] } | null)?.taskIds ?? []),
    )
  }

  /** Blocked is a flag with a reason, on top of the status. Re-blocking updates the reason. */
  async block(ctx: WorkspaceCtx, workspaceId: string, taskId: string, input: { reason: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    const reason = input.reason?.trim()
    if (!reason) throw badRequest('Say what it is waiting on', 'INVALID_REASON')
    const before = await liveTask(db, workspaceId, taskId)
    if (before.blockedAt && before.blockedReason === reason.slice(0, 280)) return toTask(before)
    return runAction(
      { action: 'task.block', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { taskId, reason }, target: { type: 'task', id: taskId } },
      async (tx) => {
        await tx.workTask.update({
          where: { id: taskId },
          data: { blockedAt: before.blockedAt ?? new Date(), blockedReason: reason.slice(0, 280), blockedByMemberId: actor.member.id, version: { increment: 1 } },
        })
        const after = await liveTask(tx, workspaceId, taskId)
        return {
          value: toTask(after),
          changes: { blockedReason: [before.blockedReason, after.blockedReason] },
          activities: [{ type: 'task.blocked', object: { taskId }, summary: { taskId, taskKey: after.taskKey, title: after.title, reason: after.blockedReason, previous: before.blockedReason } }],
        }
      },
    )
  }

  async unblock(ctx: WorkspaceCtx, workspaceId: string, taskId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    const before = await liveTask(db, workspaceId, taskId)
    if (!before.blockedAt) return toTask(before)
    return runAction(
      { action: 'task.unblock', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { taskId }, target: { type: 'task', id: taskId } },
      async (tx) => {
        await tx.workTask.update({ where: { id: taskId }, data: { blockedAt: null, blockedReason: null, blockedByMemberId: null, version: { increment: 1 } } })
        const after = await liveTask(tx, workspaceId, taskId)
        const blockedForMs = Date.now() - before.blockedAt!.getTime()
        return {
          value: toTask(after),
          changes: { blockedReason: [before.blockedReason, null] },
          activities: [{ type: 'task.unblocked', object: { taskId }, summary: { taskId, taskKey: after.taskKey, title: after.title, reason: before.blockedReason, blockedForMs } }],
        }
      },
    )
  }

  /** The task's history: every recorded event about it, oldest first. */
  async activity(userId: string, workspaceId: string, taskId: string) {
    await authorize(userId, workspaceId, 'task.read')
    const task = await db.workTask.findFirst({ where: { id: taskId, workspaceId }, select: { id: true } })
    if (!task) throw notFound('Task not found')
    const rows = await db.activity.findMany({ where: { workspaceId, taskId }, include: activityInclude, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], take: 500 })
    return { data: rows.map(toActivity) }
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
        const members = await tx.workspaceMember.findMany({ where: { workspaceId, status: 'active' }, select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } })
        const mentions = mentionedIn(text, members.map((m) => ({ id: m.id, name: m.user.profile?.displayName ?? '' }))).filter((id) => id !== actor.member.id)
        return {
          value: toComment(created),
          activities: [{ type: 'task.commented', object: { taskId }, summary: { taskId, taskKey: task.taskKey, title: task.title, commentId: created.id, excerpt: text.slice(0, 140), mentions } }],
        }
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
