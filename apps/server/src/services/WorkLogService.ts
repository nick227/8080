// "Log work" entries on the calendar, and the board's settings (WIP limits).
// Logging against a task can close it in the same transaction.
import { db, Prisma } from '@project/db'
import { badRequest, notFound } from '../lib/errors'
import { toAuthor } from '../lib/serialize'
import { runAction, type ActivityDraft } from './actions'
import { authorize, permit, type Actor } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { loadWorkflow } from './TaskWorkflowService'

type Tx = Prisma.TransactionClient

export const WORK_CATEGORIES = ['work', 'milestone', 'release', 'deal', 'meeting'] as const
const IMPORT_MAX = 500
const DAY = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

export type WorkLogInput = {
  summary: string
  day: string
  time?: string | null
  category?: (typeof WORK_CATEGORIES)[number]
  memberId?: string | null
  taskId?: string | null
  hoursSpent?: number | null
}

const logInclude = {
  member: { include: { user: { include: { profile: true } } } },
} satisfies Prisma.WorkLogInclude
type LogRow = Prisma.WorkLogGetPayload<{ include: typeof logInclude }>

export function toWorkLog(l: LogRow) {
  return {
    id: l.id,
    workspaceId: l.workspaceId,
    taskId: l.taskId,
    taskKey: l.taskKey,
    summary: l.summary,
    category: l.category,
    day: l.day,
    time: l.time,
    hoursSpent: l.hoursSpent,
    memberId: l.memberId,
    member: l.member ? { memberId: l.member.id, name: toAuthor(l.member.user).name, avatarUrl: toAuthor(l.member.user).avatarUrl } : null,
    authorMemberId: l.authorMemberId,
    authorName: l.authorName,
    createdAt: l.createdAt,
  }
}

function validDay(day: string) {
  if (!DAY.test(day)) return false
  const d = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day
}

function assertValid(input: WorkLogInput) {
  if (!input.summary?.trim()) throw badRequest('Say what was done', 'INVALID_SUMMARY')
  if (!validDay(input.day)) throw badRequest('Date must be YYYY-MM-DD', 'INVALID_DATE')
  if (input.time && !CLOCK.test(input.time)) throw badRequest('Time must be HH:MM', 'INVALID_TIME')
  if (input.hoursSpent != null && (!Number.isFinite(input.hoursSpent) || input.hoursSpent < 0 || input.hoursSpent > 24)) {
    throw badRequest('Hours must be between 0 and 24', 'INVALID_HOURS')
  }
}

async function authorName(actor: Actor) {
  const profile = await db.profile.findUnique({ where: { userId: actor.member.userId }, select: { displayName: true } })
  return (profile?.displayName ?? 'Member').slice(0, 120)
}

async function activeMemberIds(workspaceId: string) {
  return new Set((await db.workspaceMember.findMany({ where: { workspaceId, status: 'active' }, select: { id: true } })).map((m) => m.id))
}

function createData(workspaceId: string, actor: Actor, author: string, input: WorkLogInput, task: { id: string; taskKey: string } | null) {
  return {
    workspaceId,
    taskId: task?.id ?? null,
    taskKey: task?.taskKey ?? null,
    summary: input.summary.trim().slice(0, 500),
    category: input.category ?? 'work',
    day: input.day,
    time: input.time || null,
    hoursSpent: input.hoursSpent ?? null,
    memberId: input.memberId ?? null,
    authorMemberId: actor.member.id,
    authorName: author,
  }
}

/** Move a task to the workflow's first done status (no-op if it is already done). */
async function closeTask(tx: Tx, taskId: string) {
  const task = await tx.workTask.findUniqueOrThrow({ where: { id: taskId } })
  const wf = await loadWorkflow(tx, task.workspaceId)
  if (wf.isDone(task.status)) return null
  const to = wf.firstDone
  const last = await tx.workTask.findFirst({ where: { workspaceId: task.workspaceId, status: to, deletedAt: null }, orderBy: { rank: 'desc' }, select: { rank: true } })
  await tx.workTask.update({ where: { id: taskId }, data: { status: to, resolvedAt: new Date(), rank: (last?.rank ?? 0) + 1024, version: { increment: 1 } } })
  return { from: task.status, to, fromLabel: wf.label(task.status), toLabel: wf.label(to), taskKey: task.taskKey, title: task.title }
}

export class WorkLogService {
  async list(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'task.read')
    const rows = await db.workLog.findMany({ where: { workspaceId }, include: logInclude, orderBy: [{ day: 'desc' }, { time: 'desc' }, { createdAt: 'desc' }] })
    return { data: rows.map(toWorkLog) }
  }

  async create(ctx: WorkspaceCtx, workspaceId: string, input: WorkLogInput & { completeTask?: boolean }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    assertValid(input)
    if (input.memberId && !(await activeMemberIds(workspaceId)).has(input.memberId)) {
      throw badRequest('That member is not active in this workspace', 'INVALID_MEMBER')
    }
    const task = input.taskId
      ? await db.workTask.findFirst({ where: { id: input.taskId, workspaceId, deletedAt: null }, select: { id: true, taskKey: true } })
      : null
    if (input.taskId && !task) throw badRequest('That task does not exist here', 'INVALID_TASK')
    if (input.completeTask && !task) throw badRequest('Only work logged against a task can complete it', 'INVALID_TASK')
    const author = await authorName(actor)
    return runAction(
      { action: 'worklog.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { ...input }, target: { type: 'worklog' } },
      async (tx) => {
        const created = await tx.workLog.create({ data: createData(workspaceId, actor, author, input, task), include: logInclude })
        const object = task ? { taskId: task.id } : undefined
        const activities: ActivityDraft[] = [{
          type: 'worklog.created',
          object,
          summary: { workLogId: created.id, summary: created.summary, taskKey: created.taskKey, hoursSpent: created.hoursSpent, completeTask: !!input.completeTask },
        }]
        if (input.completeTask && task) {
          const closed = await closeTask(tx, task.id)
          if (closed) activities.push({ type: 'task.moved', object, summary: { taskId: task.id, taskKey: closed.taskKey, title: closed.title, from: closed.from, to: closed.to, fromLabel: closed.fromLabel, toLabel: closed.toLabel } })
        }
        return { value: toWorkLog(created), targetId: created.id, activities }
      },
    )
  }

  async remove(ctx: WorkspaceCtx, workspaceId: string, logId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.read')
    const log = await db.workLog.findFirst({ where: { id: logId, workspaceId } })
    if (!log) throw notFound('Entry not found')
    permit(actor, 'worklog.delete', { kind: 'worklog', memberIds: [log.authorMemberId, log.memberId] })
    await runAction(
      { action: 'worklog.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'worklog', id: logId } },
      async (tx) => {
        await tx.workLog.delete({ where: { id: logId } })
        return { value: null, activities: [{ type: 'worklog.deleted', summary: { workLogId: logId, summary: log.summary } }] }
      },
    )
  }

  /** Entries saved in a browser before they lived here. Unknown members are dropped. */
  async import(ctx: WorkspaceCtx, workspaceId: string, input: { entries: (WorkLogInput & { taskKey?: string | null })[]; idempotencyKey?: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    if (!input.entries.length) return { data: [] }
    if (input.entries.length > IMPORT_MAX) throw badRequest(`At most ${IMPORT_MAX} entries per import`, 'TOO_MANY_ENTRIES')
    input.entries.forEach(assertValid)
    const members = await activeMemberIds(workspaceId)
    const keys = [...new Set(input.entries.map((e) => e.taskKey?.toUpperCase()).filter((k): k is string => !!k))]
    const tasks = new Map(
      (await db.workTask.findMany({ where: { workspaceId, taskKey: { in: keys }, deletedAt: null }, select: { id: true, taskKey: true } })).map((t) => [t.taskKey.toUpperCase(), t]),
    )
    const author = await authorName(actor)
    const rows = input.entries.map((e) => ({ ...e, memberId: e.memberId && members.has(e.memberId) ? e.memberId : null }))
    const load = async (ids: string[]) => ({
      data: (await db.workLog.findMany({ where: { id: { in: ids }, workspaceId }, include: logInclude, orderBy: { createdAt: 'asc' } })).map(toWorkLog),
    })
    return runAction(
      { action: 'worklog.import', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { count: rows.length, entries: rows }, idempotencyKey: input.idempotencyKey, target: { type: 'worklog' } },
      async (tx) => {
        const ids: string[] = []
        for (const row of rows) {
          const task = row.taskKey ? tasks.get(row.taskKey.toUpperCase()) ?? null : null
          const data = createData(workspaceId, actor, author, row, task)
          // Keep the key as written even when the task isn't here (history only).
          if (!task && row.taskKey) data.taskKey = row.taskKey.toUpperCase().slice(0, 32)
          ids.push((await tx.workLog.create({ data, select: { id: true } })).id)
        }
        const value = { data: (await tx.workLog.findMany({ where: { id: { in: ids } }, include: logInclude, orderBy: { createdAt: 'asc' } })).map(toWorkLog) }
        return { value, result: { workLogIds: ids }, activities: [{ type: 'worklog.imported', summary: { count: ids.length } }] }
      },
      async (previous) => load((previous.result as { workLogIds?: string[] } | null)?.workLogIds ?? []),
    )
  }

  async board(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'task.read')
    const row = await db.taskBoardSettings.findUnique({ where: { workspaceId } })
    return { wipLimits: (row?.wipLimits ?? {}) as Record<string, number> }
  }

  async setBoard(ctx: WorkspaceCtx, workspaceId: string, input: { wipLimits: Record<string, number | null> }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.board.manage')
    const wf = await loadWorkflow(db, workspaceId)
    const limits: Record<string, number> = {}
    for (const [status, value] of Object.entries(input.wipLimits)) {
      if (!wf.isActive(status)) throw badRequest(`Unknown column "${status}"`, 'INVALID_COLUMN')
      if (value === null) continue
      if (!Number.isInteger(value) || value < 1 || value > 999) throw badRequest('A WIP limit is a whole number from 1 to 999', 'INVALID_WIP_LIMIT')
      limits[status] = value
    }
    return runAction(
      { action: 'task.board.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { wipLimits: limits }, target: { type: 'taskBoard', id: workspaceId } },
      async (tx) => {
        const before = await tx.taskBoardSettings.findUnique({ where: { workspaceId } })
        await tx.taskBoardSettings.upsert({ where: { workspaceId }, create: { workspaceId, wipLimits: limits }, update: { wipLimits: limits } })
        return { value: { wipLimits: limits }, changes: { wipLimits: [before?.wipLimits ?? {}, limits] }, activities: [{ type: 'task.board.updated', summary: { wipLimits: limits } }] }
      },
    )
  }
}
