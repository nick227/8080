// Due-date reminders: the assignee hears once when a task is due tomorrow and once
// when it becomes overdue (the day after its due date), from 8 AM in the workspace's
// time zone. Time-driven, not a change to the task, so no Activity row: the notice
// goes straight to the assignee's inbox (deduped per task, due date and kind) and
// follows their email choice like a direct notice. Done tasks never remind.
import { db } from '@project/db'
import { localDayKey } from '../lib/workspaceDay'
import { fanOut, type InboxItemView } from './inboxFanOut'
import { releaseInbox } from './inboxHub'
import { queueTaskEmails, sendTaskEmails, wantsEmail } from './taskEmail'
import { loadWorkflow } from './TaskWorkflowService'

const DAY_MS = 86_400_000
/** Local hour from which a day's reminders go out. */
export const REMIND_FROM_HOUR = 8

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const localHour = (at: Date, timeZone: string) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at))

const shortDay = (day: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`))

/** Sends the reminders due at `now`. Safe to run often: each reminder is sent once. */
export async function remindDueTasks(now = new Date()) {
  // Due dates are calendar days; any workspace's "tomorrow" or "yesterday" falls in this window.
  const tasks = await db.workTask.findMany({
    where: { deletedAt: null, assigneeMemberId: { not: null }, dueDate: { gte: new Date(now.getTime() - 3 * DAY_MS), lte: new Date(now.getTime() + 3 * DAY_MS) } },
    select: { id: true, workspaceId: true, taskKey: true, title: true, status: true, dueDate: true, assigneeMemberId: true, workspace: { select: { timezone: true } } },
  })
  const workflows = new Map<string, Awaited<ReturnType<typeof loadWorkflow>>>()
  const created: InboxItemView[] = []
  const emailed: string[] = []
  for (const t of tasks) {
    const tz = t.workspace.timezone || 'UTC'
    if (localHour(now, tz) < REMIND_FROM_HOUR) continue
    const today = localDayKey(now, tz)
    const due = t.dueDate!.toISOString().slice(0, 10)
    const kind = due === addDays(today, 1) ? 'soon' : due === addDays(today, -1) ? 'overdue' : null
    if (!kind) continue
    if (!workflows.has(t.workspaceId)) workflows.set(t.workspaceId, await loadWorkflow(db, t.workspaceId))
    if (workflows.get(t.workspaceId)!.isDone(t.status)) continue
    const member = await db.workspaceMember.findFirst({ where: { id: t.assigneeMemberId!, workspaceId: t.workspaceId, status: 'active' }, select: { id: true, taskEmail: true } })
    if (!member) continue
    const dedupeKey = `due:${kind}:${t.id}:${due}`
    // Each reminder once: an existing row (even read or archived) means it was sent.
    if (await db.inboxItem.findUnique({ where: { memberId_dedupeKey: { memberId: member.id, dedupeKey } }, select: { id: true } })) continue
    await db.$transaction(async (tx) => {
      const rows = await fanOut(tx, t.workspaceId, {
        type: 'task',
        title: (kind === 'soon' ? `${t.taskKey} is due tomorrow` : `${t.taskKey} is overdue (was due ${shortDay(due)})`).slice(0, 200),
        summary: t.title.slice(0, 500),
        sourceType: 'task',
        sourceId: t.id,
        dedupeKey,
        action: { verb: 'open' },
        actorMemberId: null,
        memberIds: [member.id],
      })
      if (wantsEmail(member.taskEmail, true)) {
        await queueTaskEmails(tx, rows.map((r) => r.id))
        emailed.push(...rows.map((r) => r.id))
      }
      created.push(...rows)
    })
  }
  created.forEach(releaseInbox)
  sendTaskEmails(emailed)
  return created
}

let timer: ReturnType<typeof setInterval> | null = null

/** Single instance, like the agents runner; AGENTS_SCHEDULER=off disables it too. */
export function startTaskReminders(intervalMs = 10 * 60_000) {
  if (process.env.AGENTS_SCHEDULER === 'off' || timer) return false
  let busy = false
  timer = setInterval(() => {
    if (busy) return
    busy = true
    remindDueTasks()
      .catch((err) => console.error('task reminders: run failed', err))
      .finally(() => { busy = false })
  }, intervalMs)
  timer.unref()
  return true
}

export function stopTaskReminders() {
  if (timer) clearInterval(timer)
  timer = null
}
