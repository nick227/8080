// Work Session: one open session per member, pauses don't count, switching closes
// the task's segment, updates are durable events on the task's history, stop
// summarises (and can log work), corrections keep the original bounds.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, validateResponse, testUserId, testOtherUserId } from './helpers'
import { caller, carolId, daveId, createWorkspace, join, memberId, seedPeople } from './helpers/workspace'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'
import { drainTaskStream, joinTaskStream, type TaskFrame } from '../services/taskStream'

const app = buildTestApp()
const call = caller(app)
const MIN = 60_000

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  const carol = await join(app, ws.id, carolId, 'carol@test.local')
  const base = `/workspaces/${ws.id}`
  const task = async (title: string) => {
    const res = await call(testUserId, 'POST', `${base}/tasks`, { title })
    if (res.statusCode !== 201) throw new Error(res.body)
    return res.json().data as { id: string; taskKey: string; status: string }
  }
  return { ws, carol, base, task, alice: await memberId(ws.id, testUserId) }
}

/** Moves a member's open session (and its segments) back in time, as if it started `ms` ago. */
async function backdate(sessionId: string, ms: number) {
  const segs = await db.workSegment.findMany({ where: { sessionId } })
  for (const s of segs) {
    await db.workSegment.update({ where: { id: s.id }, data: { startedAt: new Date(s.startedAt.getTime() - ms), endedAt: s.endedAt ? new Date(s.endedAt.getTime() - ms) : null } })
  }
  const session = await db.workSession.findUniqueOrThrow({ where: { id: sessionId } })
  await db.workSession.update({ where: { id: sessionId }, data: { startedAt: new Date(session.startedAt.getTime() - ms), endedAt: session.endedAt ? new Date(session.endedAt.getTime() - ms) : null } })
}

describe('work sessions', () => {
  it('starts one session per member, shows it in the lobby, and refuses a second start', async () => {
    const { base, task, alice } = await setup()
    const t = await task('Homepage layout')

    const started = await call(testUserId, 'POST', `${base}/work-sessions`, { taskId: t.id })
    expect(started.statusCode).toBe(201)
    await validateResponse('startWorkSession', 201, started.json())
    expect(started.json().data).toMatchObject({ memberId: alice, state: 'working', task: { taskKey: t.taskKey }, workedMs: 0 })
    expect(started.json().data.runningSince).not.toBeNull()

    const again = await call(testUserId, 'POST', `${base}/work-sessions`, {})
    expect(again.statusCode).toBe(409)
    expect(again.json().code).toBe('SESSION_OPEN')

    const lobby = await call(carolId, 'GET', `${base}/work-sessions/lobby`)
    expect(lobby.statusCode).toBe(200)
    await validateResponse('getWorkLobby', 200, lobby.json())
    const d = lobby.json().data
    // Working members first; Carol is off and sees her own (empty) clock.
    expect(d.members.map((m: any) => [m.name, m.state])).toEqual([['Alice', 'working'], ['Carol', 'off']])
    expect(d.members[0].task.title).toBe('Homepage layout')
    expect(d.me.session).toBeNull()

    // Nothing to pause when nothing runs.
    expect((await call(carolId, 'POST', `${base}/work-sessions/current/pause`)).json().code).toBe('NO_SESSION')
    // Bob (a guest, not a member) can't see the lobby.
    expect((await call(testOtherUserId, 'GET', `${base}/work-sessions/lobby`)).statusCode).toBe(404)
  })

  it("counts working time only: pauses don't count, switching closes the task's segment, stop keeps exact minutes", async () => {
    const { base, task } = await setup()
    const a = await task('Navigation')
    const b = await task('Footer')

    const s = (await call(testUserId, 'POST', `${base}/work-sessions`, { taskId: a.id })).json().data
    await backdate(s.id, 16 * MIN) // started 16 minutes ago on A
    const paused = await call(testUserId, 'POST', `${base}/work-sessions/current/pause`)
    await validateResponse('pauseWorkSession', 200, paused.json())
    expect(paused.json().data.state).toBe('paused')
    expect(paused.json().data.workedMs).toBeGreaterThanOrEqual(16 * MIN)
    expect(paused.json().data.workedMs).toBeLessThan(16 * MIN + 5000)
    expect((await call(testUserId, 'POST', `${base}/work-sessions/current/pause`)).json().code).toBe('SESSION_PAUSED')

    await backdate(s.id, 30 * MIN) // the pause lasted 30 minutes
    const resumed = await call(testUserId, 'POST', `${base}/work-sessions/current/resume`)
    expect(resumed.json().data).toMatchObject({ state: 'working', task: { id: a.id } })
    await backdate(s.id, 10 * MIN)

    const switched = await call(testUserId, 'POST', `${base}/work-sessions/current/switch`, { taskId: b.id })
    await validateResponse('switchWorkSessionTask', 200, switched.json())
    expect(switched.json().data.task.id).toBe(b.id)
    expect(switched.json().data.segments.map((g: any) => [g.task?.id, g.endedAt === null])).toEqual([[a.id, false], [a.id, false], [b.id, true]])
    await backdate(s.id, 5 * MIN)

    const stopped = await call(testUserId, 'POST', `${base}/work-sessions/current/stop`, {})
    expect(stopped.statusCode).toBe(200)
    await validateResponse('stopWorkSession', 200, stopped.json())
    const sum = stopped.json().data
    expect(sum.session.state).toBe('stopped')
    // 16 + 10 on A, 5 on B: 31 minutes, the 30-minute pause excluded.
    expect(Math.round(sum.session.workedMs / MIN)).toBe(31)
    expect(sum.tasks.map((t: any) => [t.task.id, Math.round(t.workedMs / MIN)])).toEqual([[a.id, 26], [b.id, 5]])
    expect(sum.workLog).toBeNull()

    // The open key is released: a new session can start.
    expect((await call(testUserId, 'POST', `${base}/work-sessions`, {})).statusCode).toBe(201)

    // A's history tells the story from the same Activity rows.
    const history = (await call(testUserId, 'GET', `${base}/tasks/${a.id}/activity`)).json().data.map((x: any) => x.type)
    expect(history).toEqual(expect.arrayContaining(['worksession.started', 'worksession.segment', 'worksession.resumed']))
    expect(history.filter((x: string) => x === 'worksession.segment')).toHaveLength(2)
    const bHistory = (await call(testUserId, 'GET', `${base}/tasks/${b.id}/activity`)).json().data.map((x: any) => x.type)
    expect(bHistory).toEqual(expect.arrayContaining(['worksession.switched', 'worksession.segment']))
  })

  it('posts updates as durable events on the current task, and shows them in the lobby', async () => {
    const { base, task } = await setup()
    const t = await task('Responsive header')
    await call(testUserId, 'POST', `${base}/work-sessions`, { taskId: t.id })
    const posted = await call(testUserId, 'POST', `${base}/work-updates`, { text: ' Finished navigation layout ' })
    expect(posted.statusCode).toBe(201)
    await validateResponse('postWorkUpdate', 201, posted.json())
    expect(posted.json().data).toMatchObject({ text: 'Finished navigation layout', name: 'Alice', task: { id: t.id } })

    // Without a session, an update is still recorded (general, no task).
    const carolUpdate = await call(carolId, 'POST', `${base}/work-updates`, { text: 'Reviewing copy' })
    expect(carolUpdate.json().data.task).toBeNull()
    expect((await call(carolId, 'POST', `${base}/work-updates`, { text: '   ' })).statusCode).toBe(400)

    const lobby = (await call(testUserId, 'GET', `${base}/work-sessions/lobby`)).json().data
    expect(lobby.updates.map((u: any) => u.text)).toEqual(['Reviewing copy', 'Finished navigation layout'])
    expect(lobby.members.find((m: any) => m.name === 'Alice').lastUpdate.text).toBe('Finished navigation layout')
    expect(lobby.me.markers.map((m: any) => m.type)).toEqual(['worksession.started', 'worksession.update'])

    const history = (await call(testUserId, 'GET', `${base}/tasks/${t.id}/activity`)).json().data
    expect(history.find((x: any) => x.type === 'worksession.update').summary.text).toBe('Finished navigation layout')

    const time = await call(testUserId, 'GET', `${base}/work-time?taskId=${t.id}`)
    await validateResponse('getWorkTime', 200, time.json())
    expect(time.json().data[0]).toMatchObject({ taskId: t.id, sessions: 1, runningCount: 1, workingNow: [{ name: 'Alice' }], lastUpdate: { text: 'Finished navigation layout' } })
  })

  it('stopping with what got done logs work with the session hours, and can close the task', async () => {
    const { base, task, alice } = await setup()
    const t = await task('Client proposal')
    const s = (await call(testUserId, 'POST', `${base}/work-sessions`, { taskId: t.id })).json().data
    await backdate(s.id, 90 * MIN)
    expect((await call(testUserId, 'POST', `${base}/work-sessions/current/stop`, { completeTask: true })).json().code).toBe('INVALID_SUMMARY')
    const stopped = await call(testUserId, 'POST', `${base}/work-sessions/current/stop`, { accomplishment: 'Sent the proposal', completeTask: true })
    expect(stopped.statusCode).toBe(200)
    expect(stopped.json().data.workLog).toMatchObject({ summary: 'Sent the proposal', taskId: t.id, hoursSpent: 1.5, memberId: alice })
    const after = (await call(testUserId, 'GET', `${base}/tasks/${t.id}`)).json().data
    expect(after.status).toBe('done')
    expect((await call(testUserId, 'GET', `${base}/work-logs`)).json().data).toHaveLength(1)
  })

  it('corrects closed time (own or admin), keeps the original bounds, refuses overlaps; adds missed time', async () => {
    const { ws, base, task } = await setup()
    const dave = await join(app, ws.id, daveId, 'dave@test.local')
    expect(dave).toBeTruthy()
    const t = await task('QA testing')
    const s = (await call(carolId, 'POST', `${base}/work-sessions`, { taskId: t.id })).json().data
    await backdate(s.id, 60 * MIN)
    const seg = (await call(carolId, 'POST', `${base}/work-sessions/current/stop`, {})).json().data.session.segments[0]

    const start = new Date(Date.parse(seg.startedAt) - 15 * MIN).toISOString()
    // Dave (a member) can't touch Carol's time; the running segment can't be corrected.
    expect((await call(daveId, 'PATCH', `${base}/work-segments/${seg.id}`, { startedAt: start, endedAt: seg.endedAt, reason: 'x' })).statusCode).toBe(403)
    expect((await call(carolId, 'PATCH', `${base}/work-segments/${seg.id}`, { startedAt: seg.endedAt, endedAt: seg.startedAt, reason: 'x' })).json().code).toBe('INVALID_RANGE')

    const fixed = await call(carolId, 'PATCH', `${base}/work-segments/${seg.id}`, { startedAt: start, endedAt: seg.endedAt, reason: 'Started before I clocked in' })
    expect(fixed.statusCode).toBe(200)
    await validateResponse('correctWorkSegment', 200, fixed.json())
    const after = fixed.json().data
    expect(Math.round(after.workedMs / MIN)).toBe(75)
    expect(after.segments[0].corrected.originalStartedAt).toBe(seg.startedAt)
    expect(after.startedAt).toBe(start) // the session widens to cover it

    // Alice (owner) can correct too; the first original bounds stay.
    const later = new Date(Date.parse(seg.endedAt) - 5 * MIN).toISOString()
    const again = await call(testUserId, 'PATCH', `${base}/work-segments/${seg.id}`, { startedAt: start, endedAt: later, reason: 'Lunch' })
    expect(again.json().data.segments[0].corrected.originalStartedAt).toBe(seg.startedAt)
    expect(again.json().data.segments[0].corrected.originalEndedAt).toBe(seg.endedAt)

    const corrections = (await call(testUserId, 'GET', `${base}/tasks/${t.id}/activity`)).json().data.filter((x: any) => x.type === 'worksession.corrected')
    expect(corrections.map((c: any) => c.summary.reason)).toEqual(['Started before I clocked in', 'Lunch'])
    const audit = await db.actionExecution.findMany({ where: { workspaceId: ws.id, action: 'worksession.correct', status: 'succeeded' } })
    expect(audit[0]!.changes).toMatchObject({ startedAt: [seg.startedAt, start] })

    // Missed time can be added, but not on top of recorded time.
    const overlap = await call(carolId, 'POST', `${base}/work-segments`, { startedAt: start, endedAt: later, reason: 'dup', taskId: t.id })
    expect(overlap.json().code).toBe('SEGMENT_OVERLAP')
    const dayBefore = Date.now() - 26 * 60 * MIN
    const added = await call(carolId, 'POST', `${base}/work-segments`, { startedAt: new Date(dayBefore).toISOString(), endedAt: new Date(dayBefore + 45 * MIN).toISOString(), reason: 'Forgot to clock in', taskId: t.id })
    expect(added.statusCode).toBe(201)
    expect(added.json().data).toMatchObject({ state: 'stopped', workedMs: 45 * MIN })

    // The calendar's range read, and the per-task total.
    const list = await call(testUserId, 'GET', `${base}/work-sessions?from=${new Date(Date.now() - 3 * 86_400_000).toISOString()}&to=${new Date().toISOString()}`)
    expect(list.statusCode).toBe(200)
    await validateResponse('listWorkSessions', 200, list.json())
    expect(list.json().data.map((x: any) => x.member.name)).toEqual(['Carol', 'Carol'])
    const total = (await call(testUserId, 'GET', `${base}/work-time`)).json().data.find((r: any) => r.taskId === t.id)
    expect(Math.round(total.workedMs / MIN)).toBe(70 + 45)
    expect(total.people).toEqual([expect.objectContaining({ name: 'Carol' })])

    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('tells live viewers when sessions change', async () => {
    const { ws, base } = await setup()
    const frames: TaskFrame[] = []
    const joined = joinTaskStream(ws.id, null, (f) => frames.push(f))
    await call(testUserId, 'POST', `${base}/work-sessions`, {})
    await call(testUserId, 'POST', `${base}/work-sessions/current/pause`)
    await drainTaskStream(ws.id)
    joined.leave()
    expect(frames.filter((f) => f.event === 'worksessions.changed').map((f) => f.data.type)).toEqual(['worksession.started', 'worksession.paused'])
  })
})
