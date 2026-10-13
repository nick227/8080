// Work Session: the workspace time clock and team lobby. A session is the
// container (one member, start → stop), a segment measures time on one task (or
// general work), and Activity rows (`worksession.*`) explain what happened —
// the same rows task history, notifications and the live stream read. Pauses are
// the gaps between segments. Timestamps are exact; only the UI rounds (5 min).
// Nothing is written while time passes: elapsed time is derived from the rows.
import { db, Prisma } from '@project/db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { toAuthor } from '../lib/serialize'
import { localDayBounds, localDayKey } from '../lib/workspaceDay'
import { runAction, type ActivityDraft } from './actions'
import { closeTask, toWorkLog, workLogInclude } from './WorkLogService'
import { authorize, permit, type Actor } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'

type Tx = Prisma.TransactionClient

const RANGE_MAX_DAYS = 62
const UPDATE_MAX = 500
const UPDATES_SHOWN = 30
// A correction may reach back this far (forgotten clock-outs, missed mornings).
const CORRECT_BACK_DAYS = 31

const taskSel = { select: { id: true, taskKey: true, title: true, deletedAt: true } } as const
const memberSel = { include: { user: { include: { profile: true } } } } as const
const sessionInclude = {
  task: taskSel,
  segments: { include: { task: taskSel }, orderBy: { startedAt: 'asc' } },
} satisfies Prisma.WorkSessionInclude
type SessionRow = Prisma.WorkSessionGetPayload<{ include: typeof sessionInclude }>
type TaskSel = { id: string; taskKey: string; title: string; deletedAt: Date | null } | null
type SegmentLike = { startedAt: Date; endedAt: Date | null }

const taskRef = (t: TaskSel) => (t ? { id: t.id, taskKey: t.taskKey, title: t.title, deleted: !!t.deletedAt } : null)

/** Counted time of a segment, optionally clipped to [from, to). Running = up to `now`. */
export function segmentMs(s: SegmentLike, now: Date, from?: Date, to?: Date) {
  const start = Math.max(s.startedAt.getTime(), from?.getTime() ?? -Infinity)
  const end = Math.min((s.endedAt ?? now).getTime(), to?.getTime() ?? Infinity)
  return Math.max(0, end - start)
}

function toSegment(s: SessionRow['segments'][number]) {
  return {
    id: s.id,
    sessionId: s.sessionId,
    memberId: s.memberId,
    task: taskRef(s.task),
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    // Closed segments only; a running one is counted by the client from startedAt.
    workedMs: s.endedAt ? s.endedAt.getTime() - s.startedAt.getTime() : null,
    corrected: s.correctedAt
      ? { at: s.correctedAt, originalStartedAt: s.originalStartedAt ?? s.startedAt, originalEndedAt: s.originalEndedAt }
      : null,
  }
}

export function toSession(row: SessionRow) {
  const running = row.segments.find((s) => !s.endedAt) ?? null
  return {
    id: row.id,
    memberId: row.memberId,
    state: row.state as 'working' | 'paused' | 'stopped',
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    task: taskRef(row.task),
    // Closed time; add (now − runningSince) for the live total.
    workedMs: row.segments.reduce((sum, s) => sum + (s.endedAt ? s.endedAt.getTime() - s.startedAt.getTime() : 0), 0),
    runningSince: running?.startedAt ?? null,
    segments: row.segments.map(toSegment),
    version: row.version,
  }
}

const isKeyConflict = (err: unknown) => (err as { code?: string })?.code === 'P2002'

async function openSession(db_: Tx | typeof db, memberId: string) {
  return db_.workSession.findUnique({ where: { openKey: memberId }, include: sessionInclude })
}

async function liveTask(workspaceId: string, taskId: string | null | undefined) {
  if (!taskId) return null
  const task = await db.workTask.findFirst({ where: { id: taskId, workspaceId, deletedAt: null }, select: taskSel.select })
  if (!task) throw badRequest('That task does not exist here', 'INVALID_TASK')
  return task
}

const taskObject = (taskId: string | null | undefined) => (taskId ? { taskId } : undefined)
const taskSummary = (t: TaskSel) => (t ? { taskId: t.id, taskKey: t.taskKey, title: t.title } : { taskId: null })

/** Closes the running segment (if any) at `at`; returns its activity line when it was on a task. */
async function closeRunning(tx: Tx, session: SessionRow, at: Date): Promise<ActivityDraft[]> {
  const running = session.segments.find((s) => !s.endedAt)
  if (!running) return []
  await tx.workSegment.update({ where: { id: running.id }, data: { endedAt: at } })
  running.endedAt = at
  if (!running.taskId) return []
  return [{
    type: 'worksession.segment',
    object: { taskId: running.taskId },
    occurredAt: at,
    summary: { sessionId: session.id, segmentId: running.id, ...taskSummary(running.task), startedAt: running.startedAt.toISOString(), endedAt: at.toISOString(), workedMs: at.getTime() - running.startedAt.getTime() },
  }]
}

/** Moves the session to its next version, or 409 if another tab/device got there first. */
async function bump(tx: Tx, session: SessionRow, data: Prisma.WorkSessionUncheckedUpdateManyInput) {
  const res = await tx.workSession.updateMany({ where: { id: session.id, version: session.version }, data: { ...data, version: { increment: 1 } } })
  if (res.count !== 1) throw conflict('Your session changed on another screen. Refresh and try again.', 'SESSION_CHANGED')
}

const reload = (tx: Tx, id: string) => tx.workSession.findUniqueOrThrow({ where: { id }, include: sessionInclude })

function perTask(segments: SessionRow['segments'], now: Date) {
  const by = new Map<string, { task: ReturnType<typeof taskRef>; workedMs: number }>()
  for (const s of segments) {
    const key = s.taskId ?? ''
    const row = by.get(key) ?? { task: taskRef(s.task), workedMs: 0 }
    row.workedMs += segmentMs(s, now)
    by.set(key, row)
  }
  return [...by.values()].sort((a, b) => b.workedMs - a.workedMs)
}

const clock = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)

function parseInstant(value: unknown, field: string) {
  const at = typeof value === 'string' ? new Date(value) : null
  if (!at || Number.isNaN(at.getTime())) throw badRequest(`${field} must be a date-time`, 'INVALID_TIME')
  return at
}

export type WorkSessionInput = { taskId?: string | null }
export type StopInput = { accomplishment?: string | null; completeTask?: boolean; taskId?: string | null }
export type UpdateInput = { text: string; taskId?: string | null }
export type CorrectInput = { startedAt: string; endedAt: string; reason: string }
export type AddTimeInput = CorrectInput & { taskId?: string | null }

export class WorkSessionService {
  private async clockActor(userId: string, workspaceId: string) {
    return authorize(userId, workspaceId, 'worksession.write')
  }

  private action(ctx: WorkspaceCtx, actor: Actor, action: string, input: Record<string, unknown>, id?: string) {
    return { action, workspaceId: actor.workspace.id, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'workSession', id } }
  }

  async start(ctx: WorkspaceCtx, workspaceId: string, input: WorkSessionInput) {
    const actor = await this.clockActor(ctx.user.id, workspaceId)
    const task = await liveTask(workspaceId, input.taskId)
    const memberId = actor.member.id
    try {
      return await runAction(this.action(ctx, actor, 'worksession.start', { ...input }), async (tx) => {
        if (await openSession(tx, memberId)) throw conflict('You already have a session running', 'SESSION_OPEN')
        const now = new Date()
        const created = await tx.workSession.create({
          data: { workspaceId, memberId, state: 'working', openKey: memberId, startedAt: now, taskId: task?.id ?? null },
        })
        await tx.workSegment.create({ data: { sessionId: created.id, workspaceId, memberId, taskId: task?.id ?? null, startedAt: now } })
        const row = await reload(tx, created.id)
        return {
          value: toSession(row),
          targetId: created.id,
          activities: [{ type: 'worksession.started', object: taskObject(task?.id), occurredAt: now, summary: { sessionId: created.id, ...taskSummary(task) } }],
        }
      })
    } catch (err) {
      // Two screens pressed Start at once: the unique open key let one through.
      if (isKeyConflict(err)) throw conflict('You already have a session running', 'SESSION_OPEN')
      throw err
    }
  }

  private async withOpen<T>(
    ctx: WorkspaceCtx,
    workspaceId: string,
    action: string,
    input: Record<string, unknown>,
    perform: (tx: Tx, session: SessionRow, now: Date, actor: Actor) => Promise<{ value: T; activities: ActivityDraft[] }>,
  ) {
    const actor = await this.clockActor(ctx.user.id, workspaceId)
    const current = await openSession(db, actor.member.id)
    if (!current || current.workspaceId !== workspaceId) throw conflict('No session is running', 'NO_SESSION')
    return runAction(this.action(ctx, actor, action, input, current.id), async (tx) => {
      const session = await openSession(tx, actor.member.id)
      if (!session || session.id !== current.id) throw conflict('No session is running', 'NO_SESSION')
      const out = await perform(tx, session, new Date(), actor)
      return { value: out.value, targetId: session.id, activities: out.activities }
    })
  }

  pause(ctx: WorkspaceCtx, workspaceId: string) {
    return this.withOpen(ctx, workspaceId, 'worksession.pause', {}, async (tx, session, now) => {
      if (session.state !== 'working') throw conflict('The session is already paused', 'SESSION_PAUSED')
      const closed = await closeRunning(tx, session, now)
      await bump(tx, session, { state: 'paused' })
      const row = await reload(tx, session.id)
      return { value: toSession(row), activities: [...closed, { type: 'worksession.paused', occurredAt: now, summary: { sessionId: session.id, workedMs: toSession(row).workedMs } }] }
    })
  }

  async resume(ctx: WorkspaceCtx, workspaceId: string, input: WorkSessionInput) {
    const task = input.taskId === undefined ? undefined : await liveTask(workspaceId, input.taskId)
    return this.withOpen(ctx, workspaceId, 'worksession.resume', { ...input }, async (tx, session, now, actor) => {
      if (session.state !== 'paused') throw conflict('The session is already running', 'SESSION_RUNNING')
      // Resume on the task it was paused on, unless another is chosen.
      const taskId = task === undefined ? session.taskId : task?.id ?? null
      const resumedTask = task === undefined ? session.task : task
      await tx.workSegment.create({ data: { sessionId: session.id, workspaceId, memberId: actor.member.id, taskId, startedAt: now } })
      await bump(tx, session, { state: 'working', taskId })
      const row = await reload(tx, session.id)
      return { value: toSession(row), activities: [{ type: 'worksession.resumed', object: taskObject(taskId), occurredAt: now, summary: { sessionId: session.id, ...taskSummary(resumedTask) } }] }
    })
  }

  async switchTask(ctx: WorkspaceCtx, workspaceId: string, input: { taskId: string | null }) {
    const task = await liveTask(workspaceId, input.taskId)
    return this.withOpen(ctx, workspaceId, 'worksession.switch', { ...input }, async (tx, session, now, actor) => {
      if ((session.taskId ?? null) === (task?.id ?? null)) return { value: toSession(session), activities: [] }
      const activities: ActivityDraft[] = []
      // Working: close this task's stretch and start the next. Paused: it applies on resume.
      if (session.state === 'working') {
        activities.push(...(await closeRunning(tx, session, now)))
        await tx.workSegment.create({ data: { sessionId: session.id, workspaceId, memberId: actor.member.id, taskId: task?.id ?? null, startedAt: now } })
      }
      await bump(tx, session, { taskId: task?.id ?? null })
      const row = await reload(tx, session.id)
      activities.push({
        type: 'worksession.switched',
        object: taskObject(task?.id),
        occurredAt: now,
        summary: { sessionId: session.id, ...taskSummary(task), from: taskSummary(session.task) },
      })
      return { value: toSession(row), activities }
    })
  }

  async stop(ctx: WorkspaceCtx, workspaceId: string, input: StopInput) {
    const note = input.accomplishment?.trim().slice(0, 500) || null
    if (input.completeTask && !note) throw badRequest('Say what got done to close the task', 'INVALID_SUMMARY')
    const actorRow = await this.clockActor(ctx.user.id, workspaceId)
    const profile = await db.profile.findUnique({ where: { userId: actorRow.member.userId }, select: { displayName: true } })
    const author = (profile?.displayName ?? 'Member').slice(0, 120)
    return this.withOpen(ctx, workspaceId, 'worksession.stop', { ...input }, async (tx, session, now, actor) => {
      const activities = await closeRunning(tx, session, now)
      await bump(tx, session, { state: 'stopped', endedAt: now, openKey: null })
      const row = await reload(tx, session.id)
      const tasks = perTask(row.segments, now)
      const value = toSession(row)
      const updates = await tx.activity.count({ where: { workspaceId, actorMemberId: actor.member.id, type: 'worksession.update', occurredAt: { gte: row.startedAt, lte: now } } })
      activities.push({
        type: 'worksession.stopped',
        occurredAt: now,
        summary: { sessionId: row.id, workedMs: value.workedMs, startedAt: row.startedAt.toISOString(), tasks: tasks.map((t) => ({ taskId: t.task?.id ?? null, taskKey: t.task?.taskKey ?? null, title: t.task?.title ?? null, workedMs: t.workedMs })), updates },
      })

      // What got done → one Log work entry with the session's time, on the chosen
      // task or the one worked longest. Reports read hours from these entries.
      let workLog: ReturnType<typeof toWorkLog> | null = null
      if (note) {
        const pick = input.taskId === undefined ? tasks.find((t) => t.task && !t.task.deleted)?.task?.id ?? null : input.taskId
        const task = pick ? await tx.workTask.findFirst({ where: { id: pick, workspaceId, deletedAt: null }, select: { id: true, taskKey: true } }) : null
        if (pick && !task) throw badRequest('That task does not exist here', 'INVALID_TASK')
        if (input.completeTask && !task) throw badRequest('Only work logged against a task can complete it', 'INVALID_TASK')
        const tz = actor.workspace.timezone || 'UTC'
        const hours = Math.min(24, Math.round((value.workedMs / 3_600_000) * 100) / 100)
        const created = await tx.workLog.create({
          data: {
            workspaceId, taskId: task?.id ?? null, taskKey: task?.taskKey ?? null, summary: note, category: 'work',
            day: localDayKey(row.startedAt, tz), time: clock(row.startedAt, tz), hoursSpent: hours,
            memberId: actor.member.id, authorMemberId: actor.member.id, authorName: author,
          },
          include: workLogInclude,
        })
        workLog = toWorkLog(created)
        activities.push({ type: 'worklog.created', object: taskObject(task?.id), occurredAt: now, summary: { workLogId: created.id, summary: note, taskKey: task?.taskKey ?? null, hoursSpent: hours, completeTask: !!input.completeTask, sessionId: row.id } })
        if (input.completeTask && task) {
          const closed = await closeTask(tx, task.id)
          if (closed) activities.push({ type: 'task.moved', object: { taskId: task.id }, occurredAt: now, summary: { taskId: task.id, taskKey: closed.taskKey, title: closed.title, from: closed.from, to: closed.to, fromLabel: closed.fromLabel, toLabel: closed.toLabel } })
        }
      }
      return { value: { session: value, tasks, updates, workLog }, activities }
    })
  }

  /** A progress note: a durable event, on the current task unless another (or none) is named. */
  async postUpdate(ctx: WorkspaceCtx, workspaceId: string, input: UpdateInput) {
    const actor = await this.clockActor(ctx.user.id, workspaceId)
    const text = input.text?.trim()
    if (!text) throw badRequest('Write the update first', 'INVALID_UPDATE')
    if (text.length > UPDATE_MAX) throw badRequest(`Keep updates under ${UPDATE_MAX} characters`, 'INVALID_UPDATE')
    const session = await openSession(db, actor.member.id)
    const open = session?.workspaceId === workspaceId ? session : null
    const task = input.taskId === undefined ? (open?.task && !open.task.deletedAt ? open.task : null) : await liveTask(workspaceId, input.taskId)
    const at = new Date()
    await runAction(this.action(ctx, actor, 'worksession.update', { text, taskId: task?.id ?? null }, open?.id), async () => ({
      value: null,
      targetId: open?.id,
      activities: [{ type: 'worksession.update', object: taskObject(task?.id), occurredAt: at, summary: { sessionId: open?.id ?? null, text, ...taskSummary(task) } }],
    }))
    const row = await db.activity.findFirstOrThrow({
      where: { workspaceId, actorMemberId: actor.member.id, type: 'worksession.update', occurredAt: at },
      include: { actorMember: memberSel },
      orderBy: { recordedAt: 'desc' },
    })
    return toUpdate(row)
  }

  /** Amend a closed segment's bounds. The first recorded bounds stay on the row; the change is history. */
  async correct(ctx: WorkspaceCtx, workspaceId: string, segmentId: string, input: CorrectInput) {
    const actor = await authorize(ctx.user.id, workspaceId, 'worksession.read')
    const segment = await db.workSegment.findFirst({ where: { id: segmentId, workspaceId }, include: { task: taskSel, session: true } })
    if (!segment) throw notFound('That time was not found')
    permit(actor, 'worksession.correct', { kind: 'worksession', memberId: segment.memberId })
    if (!segment.endedAt) throw badRequest('Pause or stop before correcting this time', 'SEGMENT_OPEN')
    const { start, end, reason } = this.checkRange(input)
    await this.assertFree(workspaceId, segment.memberId, start, end, segment.id)
    const from = { startedAt: segment.startedAt.toISOString(), endedAt: segment.endedAt.toISOString() }
    const to = { startedAt: start.toISOString(), endedAt: end.toISOString() }
    return runAction(
      { ...this.action(ctx, actor, 'worksession.correct', { ...input }), target: { type: 'workSegment', id: segmentId } },
      async (tx) => {
        await tx.workSegment.update({
          where: { id: segmentId },
          data: {
            startedAt: start, endedAt: end, correctedAt: new Date(),
            originalStartedAt: segment.originalStartedAt ?? segment.startedAt,
            originalEndedAt: segment.originalEndedAt ?? segment.endedAt,
          },
        })
        await this.widen(tx, segment.session, start, end)
        const row = await reload(tx, segment.sessionId)
        return {
          value: toSession(row),
          changes: { startedAt: [from.startedAt, to.startedAt], endedAt: [from.endedAt, to.endedAt] },
          activities: [{
            type: 'worksession.corrected',
            object: taskObject(segment.taskId),
            summary: { sessionId: segment.sessionId, segmentId, memberId: segment.memberId, ...taskSummary(segment.task), from, to, reason, deltaMs: (end.getTime() - start.getTime()) - (segment.endedAt!.getTime() - segment.startedAt.getTime()) },
          }],
        }
      },
    )
  }

  /** Time that was worked but never clocked: a stopped session with one segment, marked as added. */
  async addTime(ctx: WorkspaceCtx, workspaceId: string, input: AddTimeInput) {
    const actor = await this.clockActor(ctx.user.id, workspaceId)
    const task = await liveTask(workspaceId, input.taskId)
    const { start, end, reason } = this.checkRange(input)
    const memberId = actor.member.id
    await this.assertFree(workspaceId, memberId, start, end)
    return runAction(this.action(ctx, actor, 'worksession.add', { ...input }), async (tx) => {
      const created = await tx.workSession.create({ data: { workspaceId, memberId, state: 'stopped', startedAt: start, endedAt: end, taskId: task?.id ?? null } })
      // Added after the fact: there were no original bounds, so it is "corrected" from nothing.
      await tx.workSegment.create({ data: { sessionId: created.id, workspaceId, memberId, taskId: task?.id ?? null, startedAt: start, endedAt: end, correctedAt: new Date() } })
      const row = await reload(tx, created.id)
      return {
        value: toSession(row),
        targetId: created.id,
        activities: [{ type: 'worksession.added', object: taskObject(task?.id), summary: { sessionId: created.id, ...taskSummary(task), startedAt: start.toISOString(), endedAt: end.toISOString(), workedMs: end.getTime() - start.getTime(), reason } }],
      }
    })
  }

  private checkRange(input: CorrectInput) {
    const start = parseInstant(input.startedAt, 'startedAt')
    const end = parseInstant(input.endedAt, 'endedAt')
    const reason = input.reason?.trim().slice(0, 280)
    if (!reason) throw badRequest('Say why the time changed', 'INVALID_REASON')
    if (end <= start) throw badRequest('The end must be after the start', 'INVALID_RANGE')
    if (end.getTime() > Date.now() + 60_000) throw badRequest('Time can’t end in the future', 'INVALID_RANGE')
    if (start.getTime() < Date.now() - CORRECT_BACK_DAYS * 86_400_000) throw badRequest(`Corrections reach back ${CORRECT_BACK_DAYS} days`, 'INVALID_RANGE')
    if (end.getTime() - start.getTime() > 24 * 3_600_000) throw badRequest('One stretch is at most 24 hours', 'INVALID_RANGE')
    return { start, end, reason }
  }

  /** A member can't be clocked in twice at once. */
  private async assertFree(workspaceId: string, memberId: string, start: Date, end: Date, except?: string) {
    const clash = await db.workSegment.findFirst({
      where: {
        workspaceId, memberId, id: except ? { not: except } : undefined,
        startedAt: { lt: end },
        OR: [{ endedAt: null }, { endedAt: { gt: start } }],
      },
      select: { id: true },
    })
    if (clash) throw badRequest('That overlaps other recorded time', 'SEGMENT_OVERLAP')
  }

  /** A session always spans its segments (it may only grow; gaps are pauses). */
  private async widen(tx: Tx, session: { id: string; startedAt: Date; endedAt: Date | null }, start: Date, end: Date) {
    const data: Prisma.WorkSessionUpdateInput = {}
    if (start < session.startedAt) data.startedAt = start
    if (session.endedAt && end > session.endedAt) data.endedAt = end
    if (Object.keys(data).length) await tx.workSession.update({ where: { id: session.id }, data: { ...data, version: { increment: 1 } } })
  }

  // ─── reads ────────────────────────────────────────────────────────────────

  /** The homepage widget: my session and today's markers, everyone's status, today's updates. */
  async lobby(userId: string, workspaceId: string) {
    const actor = await authorize(userId, workspaceId, 'worksession.read')
    const tz = actor.workspace.timezone || 'UTC'
    const now = new Date()
    const { start, end, day } = localDayBounds(tz, now)
    const [members, open, today, updates, markers] = await Promise.all([
      db.workspaceMember.findMany({ where: { workspaceId, status: 'active' }, ...memberSel, orderBy: { joinedAt: 'asc' } }),
      db.workSession.findMany({ where: { workspaceId, openKey: { not: null } }, include: sessionInclude }),
      db.workSegment.findMany({ where: { workspaceId, startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] }, select: { memberId: true, startedAt: true, endedAt: true } }),
      db.activity.findMany({ where: { workspaceId, type: 'worksession.update', occurredAt: { gte: start } }, include: { actorMember: memberSel }, orderBy: { occurredAt: 'desc' }, take: UPDATES_SHOWN }),
      db.activity.findMany({
        where: { workspaceId, actorMemberId: actor.member.id, type: { startsWith: 'worksession.' }, occurredAt: { gte: start, lt: end } },
        orderBy: { occurredAt: 'asc' },
        select: { id: true, type: true, occurredAt: true, summary: true },
      }),
    ])
    const openBy = new Map(open.map((s) => [s.memberId, s]))
    const closedToday = new Map<string, number>()
    for (const s of today) {
      if (!s.endedAt) continue
      closedToday.set(s.memberId, (closedToday.get(s.memberId) ?? 0) + segmentMs(s, now, start, end))
    }
    const lastUpdate = new Map<string, (typeof updates)[number]>()
    for (const u of updates) if (u.actorMemberId && !lastUpdate.has(u.actorMemberId)) lastUpdate.set(u.actorMemberId, u)

    const lobby = members.map((m) => {
      const s = openBy.get(m.id)
      const running = s?.segments.find((g) => !g.endedAt) ?? null
      const last = s?.segments.at(-1)
      const author = toAuthor(m.user)
      const update = lastUpdate.get(m.id)
      return {
        memberId: m.id,
        name: author.name,
        avatarUrl: author.avatarUrl,
        title: m.title,
        state: (s?.state ?? 'off') as 'working' | 'paused' | 'off',
        // When the current state began (working = this stretch, paused = the pause).
        since: s ? (running?.startedAt ?? last?.endedAt ?? s.startedAt) : null,
        sessionStartedAt: s?.startedAt ?? null,
        task: s ? taskRef(s.task) : null,
        todayMs: closedToday.get(m.id) ?? 0,
        // Today's live total = todayMs + (now − runningSince); clipped to the day's start.
        runningSince: running ? new Date(Math.max(running.startedAt.getTime(), start.getTime())) : null,
        lastUpdate: update ? { text: String((update.summary as { text?: string }).text ?? ''), at: update.occurredAt } : null,
      }
    })
    const order = { working: 0, paused: 1, off: 2 } as const
    lobby.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name))

    // My day for the timeline: today's segments of all my sessions, plus the markers.
    const mySegments = await db.workSegment.findMany({
      where: { workspaceId, memberId: actor.member.id, startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
      include: { task: taskSel },
      orderBy: { startedAt: 'asc' },
    })
    const myOpen = openBy.get(actor.member.id)
    return {
      now,
      day,
      timezone: tz,
      dayStart: start,
      dayEnd: end,
      me: {
        memberId: actor.member.id,
        session: myOpen ? toSession(myOpen) : null,
        segments: mySegments.map(toSegment),
        markers: markers.map((a) => ({ id: a.id, type: a.type, at: a.occurredAt, summary: a.summary as Record<string, unknown> })),
      },
      members: lobby,
      updates: updates.map(toUpdate),
    }
  }

  /** Sessions overlapping [from, to) with their segments: the Calendar's actual time. */
  async list(userId: string, workspaceId: string, q: { from: string; to: string; memberId?: string; taskId?: string }) {
    await authorize(userId, workspaceId, 'worksession.read')
    const from = parseInstant(q.from, 'from')
    const to = parseInstant(q.to, 'to')
    if (to <= from || to.getTime() - from.getTime() > RANGE_MAX_DAYS * 86_400_000) throw badRequest(`Ask for up to ${RANGE_MAX_DAYS} days`, 'INVALID_RANGE')
    const rows = await db.workSession.findMany({
      where: {
        workspaceId,
        memberId: q.memberId,
        startedAt: { lt: to },
        OR: [{ endedAt: null }, { endedAt: { gt: from } }],
        segments: q.taskId ? { some: { taskId: q.taskId } } : undefined,
      },
      include: { ...sessionInclude, member: memberSel },
      orderBy: { startedAt: 'asc' },
    })
    return {
      data: rows.map((r) => ({ ...toSession(r), member: { memberId: r.member.id, name: toAuthor(r.member.user).name, avatarUrl: toAuthor(r.member.user).avatarUrl } })),
    }
  }

  /** Time per task (closed + running), who worked it and who is on it now: Board cards and task details. */
  async workTime(userId: string, workspaceId: string, q: { taskId?: string }) {
    await authorize(userId, workspaceId, 'worksession.read')
    const now = new Date()
    const [segments, open, updates] = await Promise.all([
      db.workSegment.findMany({ where: { workspaceId, taskId: q.taskId ?? { not: null } }, select: { taskId: true, memberId: true, sessionId: true, startedAt: true, endedAt: true } }),
      db.workSession.findMany({ where: { workspaceId, state: 'working', taskId: q.taskId ?? { not: null } }, select: { taskId: true, memberId: true } }),
      db.activity.findMany({
        where: { workspaceId, type: 'worksession.update', taskId: q.taskId ?? { not: null } },
        orderBy: { occurredAt: 'desc' },
        take: q.taskId ? 1 : 200,
        include: { actorMember: memberSel },
      }),
    ])
    const memberIds = [...new Set(segments.map((s) => s.memberId))]
    const names = new Map(
      (await db.workspaceMember.findMany({ where: { workspaceId, id: { in: memberIds } }, ...memberSel })).map((m) => [m.id, toAuthor(m.user)]),
    )
    type Row = { taskId: string; workedMs: number; runningSince: Date | null; sessions: Set<string>; people: Map<string, number>; lastWorkedAt: Date | null; working: string[] }
    const by = new Map<string, Row>()
    const row = (taskId: string) => {
      let r = by.get(taskId)
      if (!r) by.set(taskId, (r = { taskId, workedMs: 0, runningSince: null, sessions: new Set(), people: new Map(), lastWorkedAt: null, working: [] }))
      return r
    }
    for (const s of segments) {
      const r = row(s.taskId!)
      // Running stretches count up to now here; the client keeps counting from runningSince.
      if (s.endedAt) r.workedMs += s.endedAt.getTime() - s.startedAt.getTime()
      else if (!r.runningSince || s.startedAt < r.runningSince) r.runningSince = s.startedAt
      r.sessions.add(s.sessionId)
      r.people.set(s.memberId, (r.people.get(s.memberId) ?? 0) + segmentMs(s, now))
      const last = s.endedAt ?? now
      if (!r.lastWorkedAt || last > r.lastWorkedAt) r.lastWorkedAt = last
    }
    for (const o of open) row(o.taskId!).working.push(o.memberId)
    const lastUpdate = new Map<string, (typeof updates)[number]>()
    for (const u of updates) if (u.taskId && !lastUpdate.has(u.taskId)) lastUpdate.set(u.taskId, u)
    const person = (id: string) => ({ memberId: id, name: names.get(id)?.name ?? 'Member', avatarUrl: names.get(id)?.avatarUrl ?? null })
    return {
      now,
      data: [...by.values()].map((r) => ({
        taskId: r.taskId,
        workedMs: r.workedMs,
        runningSince: r.runningSince,
        // Several people can be on a task at once; each running stretch adds its own time.
        runningCount: segments.filter((s) => s.taskId === r.taskId && !s.endedAt).length,
        sessions: r.sessions.size,
        lastWorkedAt: r.lastWorkedAt,
        people: [...r.people.entries()].sort((a, b) => b[1] - a[1]).map(([id, ms]) => ({ ...person(id), workedMs: ms })),
        workingNow: r.working.map(person),
        lastUpdate: lastUpdate.has(r.taskId) ? toUpdate(lastUpdate.get(r.taskId)!) : null,
      })),
    }
  }
}

type UpdateRow = Prisma.ActivityGetPayload<{ include: { actorMember: typeof memberSel } }>

function toUpdate(a: UpdateRow) {
  const s = a.summary as { text?: string; sessionId?: string | null; taskId?: string | null; taskKey?: string; title?: string }
  const author = a.actorMember ? toAuthor(a.actorMember.user) : null
  return {
    id: a.id,
    memberId: a.actorMemberId,
    name: author?.name ?? 'Former member',
    avatarUrl: author?.avatarUrl ?? null,
    text: s.text ?? '',
    sessionId: s.sessionId ?? null,
    task: s.taskId ? { id: s.taskId, taskKey: s.taskKey ?? '', title: s.title ?? '', deleted: false } : null,
    at: a.occurredAt,
  }
}
