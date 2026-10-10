// A workspace's task statuses (board columns). Seeded with the defaults on first
// use; admins rename, reorder, add, categorise and archive them. Keys never change.
// Archiving a status that still holds tasks moves them to a status the admin picks,
// each move recorded on the task (no notifications: it's a workflow change).
import { db, Prisma } from '@project/db'
import { DEFAULT_TASK_STATUSES, STATUS_CATEGORIES, statusKeyFor, workflowOf, workflowProblem, type StatusCategory, type StatusDef, type Workflow } from '@project/shared'
import { badRequest } from '../lib/errors'
import { runAction, type ActivityDraft } from './actions'
import { authorize } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'

type Client = Prisma.TransactionClient | typeof db

const CATEGORIES = new Set<string>(STATUS_CATEGORIES.map((c) => c.key))
const RANK_STEP = 1024

const present = (r: { key: string; label: string; category: string; position: number; handoff: boolean; archived: boolean }): StatusDef => ({
  key: r.key,
  label: r.label,
  category: r.category as StatusCategory,
  position: r.position,
  handoff: r.handoff,
  archived: r.archived,
})

/** Idempotent seed (safe on every read). */
export async function ensureStatuses(client: Client, workspaceId: string) {
  if (await client.taskStatusDef.count({ where: { workspaceId } })) return
  await client.taskStatusDef.createMany({ data: DEFAULT_TASK_STATUSES.map((s) => ({ workspaceId, ...s })), skipDuplicates: true })
}

export async function loadWorkflow(client: Client, workspaceId: string): Promise<Workflow> {
  await ensureStatuses(client, workspaceId)
  const rows = await client.taskStatusDef.findMany({ where: { workspaceId }, orderBy: { position: 'asc' } })
  return workflowOf(rows.map(present))
}

/** 400 unless `status` is an active status of this workspace. */
export function assertStatus(wf: Workflow, status: string | undefined) {
  if (status !== undefined && !wf.isActive(status)) throw badRequest(`Unknown status "${status}"`, 'INVALID_STATUS')
}

export type StatusInput = { key?: string; label: string; category: StatusCategory; handoff?: boolean; archived?: boolean }

export class TaskWorkflowService {
  async list(userId: string, workspaceId: string) {
    await authorize(userId, workspaceId, 'task.read')
    return { data: (await loadWorkflow(db, workspaceId)).all }
  }

  /**
   * Replace the workflow with `statuses`, in that order. Existing keys must be
   * existing statuses; entries without a key are new. An existing status left out
   * is archived. `reassign` says where tasks in newly archived statuses go.
   */
  async update(ctx: WorkspaceCtx, workspaceId: string, input: { statuses: StatusInput[]; reassign?: Record<string, string> }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.board.manage')
    const before = await loadWorkflow(db, workspaceId)
    const known = new Set(before.all.map((s) => s.key))
    const taken = new Set(known)
    const listed = new Set<string>()
    const next: StatusDef[] = input.statuses.map((s, position) => {
      if (!CATEGORIES.has(s.category)) throw badRequest(`Unknown category "${s.category}"`, 'INVALID_CATEGORY')
      let key = s.key
      if (key) {
        if (!known.has(key)) throw badRequest(`Unknown status "${key}"`, 'INVALID_STATUS')
        if (listed.has(key)) throw badRequest(`Status "${key}" is listed twice`, 'INVALID_STATUS')
      } else {
        key = statusKeyFor(s.label, taken)
        taken.add(key)
      }
      listed.add(key)
      return { key, label: s.label.trim(), category: s.category, position, handoff: !!s.handoff, archived: !!s.archived }
    })
    // Left out = archived (kept for history and labels), after the listed ones.
    for (const old of before.all) if (!listed.has(old.key)) next.push({ ...old, archived: true, position: next.length })
    const problem = workflowProblem(next)
    if (problem) throw badRequest(problem, 'INVALID_WORKFLOW')
    const after = workflowOf(next)

    // Statuses archived now that still hold tasks need a destination.
    const leaving = before.active.filter((s) => !after.isActive(s.key)).map((s) => s.key)
    const counts = leaving.length
      ? await db.workTask.groupBy({ by: ['status'], where: { workspaceId, deletedAt: null, status: { in: leaving } }, _count: { _all: true } })
      : []
    for (const c of counts) {
      const to = input.reassign?.[c.status]
      if (!to) throw badRequest(`"${before.label(c.status)}" still has ${c._count._all} task(s): choose where they go`, 'STATUS_IN_USE')
      if (!after.isActive(to)) throw badRequest(`Tasks can only move to an active status`, 'INVALID_STATUS')
    }

    return runAction(
      { action: 'task.workflow.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { statuses: next, reassign: input.reassign ?? {} }, target: { type: 'taskWorkflow', id: workspaceId } },
      async (tx) => {
        for (const s of next) {
          await tx.taskStatusDef.upsert({
            where: { workspaceId_key: { workspaceId, key: s.key } },
            create: { workspaceId, ...s },
            update: { label: s.label, category: s.category, position: s.position, handoff: s.handoff, archived: s.archived },
          })
        }
        const activities: ActivityDraft[] = []
        for (const c of counts) {
          const to = input.reassign![c.status]!
          const tasks = await tx.workTask.findMany({ where: { workspaceId, deletedAt: null, status: c.status }, orderBy: { rank: 'asc' }, select: { id: true, taskKey: true, title: true, resolvedAt: true } })
          let rank = ((await tx.workTask.findFirst({ where: { workspaceId, deletedAt: null, status: to }, orderBy: { rank: 'desc' }, select: { rank: true } }))?.rank ?? 0) + RANK_STEP
          const doneChange = before.isDone(c.status) !== after.isDone(to)
          for (const t of tasks) {
            await tx.workTask.update({
              where: { id: t.id },
              data: { status: to, rank, version: { increment: 1 }, ...(doneChange ? { resolvedAt: after.isDone(to) ? new Date() : null } : {}) },
            })
            rank += RANK_STEP
            activities.push({
              type: 'task.moved',
              object: { taskId: t.id },
              summary: { taskId: t.id, taskKey: t.taskKey, title: t.title, from: c.status, to, fromLabel: before.label(c.status), toLabel: after.label(to), via: 'workflow' },
            })
          }
        }
        activities.push({ type: 'task.workflow.updated', summary: { statuses: next } })
        return { value: { data: after.all }, activities }
      },
    )
  }
}
