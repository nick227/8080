// Saved Calendar views: a member's own named view + filters (the URL query the
// Calendar already writes). Personal, never shared; at most 20 per member.
import { db } from '@project/db'
import { badRequest, notFound } from '../lib/errors'
import { runAction } from './actions'
import { authorize } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'

const MAX_VIEWS = 20
/** The query keys a view may hold (the Calendar's view and filters). */
const KEYS = new Set(['view', 'who', 'type', 'area', 'priority', 'attention', 'q'])

type ViewRow = { id: string; name: string; query: string; createdAt: Date }
const toTaskView = (v: ViewRow) => ({ id: v.id, name: v.name, query: v.query, createdAt: v.createdAt })

/** Keeps only known keys, in a stable order, so equal views compare equal. */
export function normalizeQuery(raw: string) {
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw)
  const out = new URLSearchParams()
  for (const key of [...KEYS]) {
    const value = params.get(key)?.trim()
    if (value) out.set(key, value)
  }
  return out.toString()
}

export class TaskViewService {
  async list(userId: string, workspaceId: string) {
    const actor = await authorize(userId, workspaceId, 'task.read')
    const rows = await db.taskView.findMany({ where: { workspaceId, memberId: actor.member.id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
    return { data: rows.map(toTaskView) }
  }

  async create(ctx: WorkspaceCtx, workspaceId: string, input: { name: string; query: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.read')
    const name = input.name?.trim()
    if (!name) throw badRequest('Name the view', 'INVALID_NAME')
    const query = normalizeQuery(input.query ?? '')
    if (query.length > 1000) throw badRequest('That view has too many filters to save', 'INVALID_QUERY')
    return runAction(
      { action: 'task.view.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { name, query }, target: { type: 'taskView' } },
      async (tx) => {
        const mine = await tx.taskView.findMany({ where: { workspaceId, memberId: actor.member.id }, select: { name: true, position: true } })
        if (mine.length >= MAX_VIEWS) throw badRequest(`You can save up to ${MAX_VIEWS} views`, 'TOO_MANY_VIEWS')
        if (mine.some((v) => v.name.toLowerCase() === name.toLowerCase())) throw badRequest('You already have a view with that name', 'DUPLICATE_NAME')
        const position = Math.max(0, ...mine.map((v) => v.position)) + 1
        const row = await tx.taskView.create({ data: { workspaceId, memberId: actor.member.id, name: name.slice(0, 60), query, position } })
        return { value: { data: toTaskView(row) }, targetId: row.id, activities: [] }
      },
    )
  }

  async remove(ctx: WorkspaceCtx, workspaceId: string, viewId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.read')
    // Someone else's view is as good as missing.
    const row = await db.taskView.findFirst({ where: { id: viewId, workspaceId, memberId: actor.member.id } })
    if (!row) throw notFound('View not found')
    return runAction(
      { action: 'task.view.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { viewId }, target: { type: 'taskView', id: viewId } },
      async (tx) => {
        await tx.taskView.delete({ where: { id: viewId } })
        return { value: { data: toTaskView(row) }, activities: [] }
      },
    )
  }
}
