// Who hears about what happens to a task: in-app inbox rows for the people it
// concerns, never a broadcast (doc/11: recipient-owned delivery). Derived from the
// task's recorded Activity rows; one row per recipient, deduped by activity.
// Channels: in-app now; email and chat attach here later as per-member choices.
import type { Activity, Prisma } from '@project/db'
import type { AfterCommit } from './activityFeed'
import { fanOut } from './inboxFanOut'
import { releaseInbox } from './inboxHub'

type Tx = Prisma.TransactionClient


type Summary = {
  taskKey?: string
  title?: string
  to?: string | null
  toLabel?: string
  /** 'workflow' = moved because its status was archived: nobody is told. */
  via?: string
  reason?: string
  excerpt?: string
  mentions?: string[]
  assigneeMemberId?: string | null
}

type Notice = { memberIds: string[]; title: string; summary: string }

/** What one task activity tells whom, given the task's people. */
export function noticesFor(
  activity: Pick<Activity, 'type' | 'actorMemberId'> & { summary: unknown },
  people: { actorName: string; assigneeId: string | null; creatorId: string | null; commenterIds: string[] },
  /** Statuses that are handoffs (the workspace workflow). */
  handoff: (status: string) => boolean = (st) => st === 'in_review' || st === 'done',
): Notice[] {
  const s = (activity.summary ?? {}) as Summary
  const key = s.taskKey ?? 'a task'
  const title = s.title ?? ''
  const who = people.actorName
  const concerned = [people.assigneeId, people.creatorId]
  switch (activity.type) {
    case 'task.created':
      return s.assigneeMemberId ? [{ memberIds: [s.assigneeMemberId], title: `${who} assigned you ${key}`, summary: title }] : []
    case 'task.assigned':
      return s.to ? [{ memberIds: [s.to], title: `${who} assigned you ${key}`, summary: title }] : []
    case 'task.moved':
      // Handoffs only (statuses flagged so in the workflow, e.g. In review, Done).
      return s.to && s.via !== 'workflow' && handoff(s.to)
        ? [{ memberIds: concerned.filter(Boolean) as string[], title: `${who} moved ${key} to ${s.toLabel ?? s.to}`, summary: title }]
        : []
    case 'task.blocked':
      return [{ memberIds: concerned.filter(Boolean) as string[], title: `${who} marked ${key} blocked`, summary: s.reason ? `${title}: ${s.reason}` : title }]
    case 'task.unblocked':
      return [{ memberIds: concerned.filter(Boolean) as string[], title: `${who} unblocked ${key}`, summary: title }]
    case 'task.commented': {
      const mentioned = s.mentions ?? []
      const others = [...concerned, ...people.commenterIds].filter((id): id is string => !!id && !mentioned.includes(id))
      const excerpt = s.excerpt ? `${title}: “${s.excerpt}”` : title
      return [
        { memberIds: mentioned, title: `${who} mentioned you on ${key}`, summary: excerpt },
        { memberIds: others, title: `${who} commented on ${key}`, summary: excerpt },
      ]
    }
    case 'task.deleted':
      return people.assigneeId ? [{ memberIds: [people.assigneeId], title: `${who} deleted ${key}`, summary: title }] : []
    default:
      return []
  }
}

export async function notifyTaskActivity(tx: Tx, activities: Activity[]): Promise<AfterCommit[]> {
  const effects: AfterCommit[] = []
  const handoffs = new Map<string, Set<string>>()
  for (const activity of activities) {
    if (!activity.taskId || !activity.type.startsWith('task.')) continue
    if (!handoffs.has(activity.workspaceId)) {
      const rows = await tx.taskStatusDef.findMany({ where: { workspaceId: activity.workspaceId, handoff: true }, select: { key: true } })
      // A workspace that never loaded its workflow still has the defaults.
      handoffs.set(activity.workspaceId, new Set(rows.length ? rows.map((r) => r.key) : ['in_review', 'done']))
    }
    const handoff = handoffs.get(activity.workspaceId)!
    const task = await tx.workTask.findUnique({ where: { id: activity.taskId }, select: { assigneeMemberId: true, createdByMemberId: true } })
    if (!task) continue
    const commenters = await tx.workComment.findMany({ where: { taskId: activity.taskId, authorMemberId: { not: null } }, select: { authorMemberId: true }, distinct: ['authorMemberId'] })
    const actor = activity.actorMemberId
      ? await tx.workspaceMember.findUnique({ where: { id: activity.actorMemberId }, select: { user: { select: { profile: { select: { displayName: true } } } } } })
      : null
    const notices = noticesFor(activity, {
      actorName: actor?.user.profile?.displayName ?? 'Someone',
      assigneeId: task.assigneeMemberId,
      creatorId: task.createdByMemberId,
      commenterIds: commenters.map((c) => c.authorMemberId!),
    }, (st) => handoff.has(st))
    const told = new Set<string>()
    for (const notice of notices) {
      // Never yourself, never twice for one event, only active members.
      const wanted = [...new Set(notice.memberIds)].filter((id) => id !== activity.actorMemberId && !told.has(id))
      if (!wanted.length) continue
      const active = await tx.workspaceMember.findMany({ where: { id: { in: wanted }, workspaceId: activity.workspaceId, status: 'active' }, select: { id: true } })
      const memberIds = active.map((m) => m.id)
      memberIds.forEach((id) => told.add(id))
      const rows = await fanOut(tx, activity.workspaceId, {
        type: 'task',
        title: notice.title.slice(0, 200),
        summary: (notice.summary || notice.title).slice(0, 500),
        sourceType: 'task',
        sourceId: activity.taskId,
        // One per event and recipient; mentions and comments on one event share it safely
        // because a recipient appears in only one notice.
        dedupeKey: `activity:${activity.id}`,
        action: { verb: 'open' },
        actorMemberId: activity.actorMemberId,
        memberIds,
      })
      effects.push(() => rows.forEach(releaseInbox))
    }
  }
  return effects
}
