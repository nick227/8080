// Calendar / Boards tasks: shared per workspace, ranked inside status columns,
// soft-deleted with restore, audited through runAction.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, validateResponse, testUserId } from './helpers'
import { caller, carolId, daveId, createWorkspace, join, seedPeople } from './helpers/workspace'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'

const app = buildTestApp()
const call = caller(app)

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  const carol = await join(app, ws.id, carolId, 'carol@test.local')
  return { ws, carol, base: `/workspaces/${ws.id}/tasks` }
}

const create = async (base: string, body: object, userId = testUserId) => {
  const res = await call(userId, 'POST', base, body)
  if (res.statusCode !== 201) throw new Error(`create task: ${res.statusCode} ${res.body}`)
  return res.json().data
}

const column = async (base: string, status: string) =>
  (await call(testUserId, 'GET', base)).json().data.filter((t: any) => t.status === status).map((t: any) => t.title)

describe('tasks', () => {
  it('creates a task with a key, shares it with every member, and edits it', async () => {
    const { base, carol } = await setup()
    const res = await call(testUserId, 'POST', base, { title: ' Ship the board ', scheduledDate: '2026-10-09', scheduledTime: '09:30', assigneeMemberId: carol, issueType: 'feature', priority: 'high', storyPoints: 3 })
    expect(res.statusCode).toBe(201)
    await validateResponse('createTask', 201, res.json())
    const task = res.json().data
    expect(task).toMatchObject({ taskKey: 'VC-101', title: 'Ship the board', status: 'open', assignee: { memberId: carol, name: 'Carol' }, version: 1, commentCount: 0, area: null })

    const second = await create(base, { title: 'Unscheduled' })
    expect(second).toMatchObject({ taskKey: 'VC-102', scheduledDate: null, storyPoints: null })

    // Carol sees the same list.
    const list = await call(carolId, 'GET', base)
    await validateResponse('listTasks', 200, list.json())
    expect(list.json().data.map((t: any) => t.taskKey)).toEqual(['VC-101', 'VC-102'])

    const patched = await call(carolId, 'PATCH', `${base}/${task.id}`, { expectedVersion: 1, title: 'Ship it', status: 'done', dueDate: '2026-10-20' })
    await validateResponse('updateTask', 200, patched.json())
    expect(patched.json().data).toMatchObject({ title: 'Ship it', status: 'done', dueDate: '2026-10-20', version: 2 })
    expect(patched.json().data.resolvedAt).not.toBeNull()
    const stale = await call(testUserId, 'PATCH', `${base}/${task.id}`, { expectedVersion: 1, title: 'Lost' })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().code).toBe('TASK_VERSION_CONFLICT')

    // Clearing the date clears the time.
    const cleared = await call(testUserId, 'PATCH', `${base}/${task.id}`, { scheduledDate: null })
    expect(cleared.json().data).toMatchObject({ scheduledDate: null, scheduledTime: null })
    // Reopening clears resolvedAt.
    expect((await call(testUserId, 'PATCH', `${base}/${task.id}`, { status: 'open' })).json().data.resolvedAt).toBeNull()
  })

  it('refuses bad input', async () => {
    const { base } = await setup()
    expect((await call(testUserId, 'POST', base, { title: '   ' })).statusCode).toBe(400)
    expect((await call(testUserId, 'POST', base, { title: 'x', scheduledDate: '2026-02-30' })).statusCode).toBe(400)
    expect((await call(testUserId, 'POST', base, { title: 'x', status: 'blocked' })).statusCode).toBe(400)
    expect((await call(testUserId, 'POST', base, { title: 'x', scheduledTime: '25:00', scheduledDate: '2026-10-09' })).statusCode).toBe(400)
    const timeOnly = await create(base, { title: 'x' })
    expect((await call(testUserId, 'PATCH', `${base}/${timeOnly.id}`, { scheduledTime: '10:00' })).json().code).toBe('INVALID_TIME')
    // Dave isn't a member: as an assignee he's refused, as a caller he gets 404.
    const daveMember = await db.workspaceMember.findFirst({ where: { userId: daveId } })
    expect(daveMember).toBeNull()
    expect((await call(testUserId, 'POST', base, { title: 'x', assigneeMemberId: 'nobody' })).json().code).toBe('INVALID_ASSIGNEE')
    expect((await call(daveId, 'GET', base)).statusCode).toBe(404)
  })

  it('moves cards between and inside columns by rank', async () => {
    const { base } = await setup()
    const a = await create(base, { title: 'A' })
    const b = await create(base, { title: 'B' })
    const c = await create(base, { title: 'C' })
    expect(await column(base, 'open')).toEqual(['A', 'B', 'C'])

    // C to the top of the column.
    const moved = await call(testUserId, 'POST', `${base}/${c.id}/move`, { status: 'open', beforeTaskId: a.id })
    await validateResponse('moveTask', 200, moved.json())
    expect(await column(base, 'open')).toEqual(['C', 'A', 'B'])

    // A into progress, then B under it, then C between them.
    await call(testUserId, 'POST', `${base}/${a.id}/move`, { status: 'in_progress' })
    await call(testUserId, 'POST', `${base}/${b.id}/move`, { status: 'in_progress', afterTaskId: a.id })
    await call(testUserId, 'POST', `${base}/${c.id}/move`, { status: 'in_progress', afterTaskId: a.id, beforeTaskId: b.id })
    expect(await column(base, 'in_progress')).toEqual(['A', 'C', 'B'])
    expect(await column(base, 'open')).toEqual([])

    // Done stamps resolvedAt; a neighbour outside the target column is refused.
    const done = await call(testUserId, 'POST', `${base}/${b.id}/move`, { status: 'done' })
    expect(done.json().data.resolvedAt).not.toBeNull()
    const bad = await call(testUserId, 'POST', `${base}/${a.id}/move`, { status: 'done', afterTaskId: c.id })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().code).toBe('INVALID_POSITION')

    const moves = await db.actionExecution.count({ where: { action: 'task.move', status: 'succeeded' } })
    expect(moves).toBe(5)
    expect(await db.activity.count({ where: { type: 'task.moved' } })).toBe(4)
  })

  it('keeps order when the gap between two cards runs out', async () => {
    const { base } = await setup()
    const top = await create(base, { title: 'top' })
    const bottom = await create(base, { title: 'bottom' })
    let above = top.id
    for (let i = 0; i < 60; i++) {
      const t = await create(base, { title: `n${i}`, afterTaskId: above, beforeTaskId: bottom.id })
      above = t.id
    }
    const titles = await column(base, 'open')
    expect(titles[0]).toBe('top')
    expect(titles.at(-1)).toBe('bottom')
    expect(titles.slice(1, -1)).toEqual(Array.from({ length: 60 }, (_, i) => `n${i}`))
  }, 60_000)

  it('deletes softly and restores in place', async () => {
    const { base } = await setup()
    const a = await create(base, { title: 'A' })
    await create(base, { title: 'B' })
    const del = await call(carolId, 'DELETE', `${base}/${a.id}`)
    expect(del.statusCode).toBe(200)
    expect(await column(base, 'open')).toEqual(['B'])
    expect((await call(testUserId, 'GET', `${base}/${a.id}`)).statusCode).toBe(404)
    const restored = await call(carolId, 'POST', `${base}/${a.id}/restore`)
    await validateResponse('restoreTask', 200, restored.json())
    expect(await column(base, 'open')).toEqual(['A', 'B'])
    expect(await db.activity.count({ where: { type: { in: ['task.deleted', 'task.restored'] } } })).toBe(2)
  })

  it('imports many tasks once per idempotency key, dropping unknown assignees', async () => {
    const { base, carol } = await setup()
    await create(base, { title: 'Existing' })
    const body = {
      idempotencyKey: 'local-adopt-1',
      tasks: [
        { title: 'One', status: 'done', scheduledDate: '2026-10-01', assigneeMemberId: carol },
        { title: 'Two', assigneeMemberId: 'user-1', issueType: 'bug' },
      ],
    }
    const res = await call(testUserId, 'POST', `${base}/import`, body)
    expect(res.statusCode).toBe(201)
    await validateResponse('importTasks', 201, res.json())
    expect(res.json().data.map((t: any) => [t.taskKey, t.title, t.assigneeMemberId])).toEqual([
      ['VC-102', 'One', carol],
      ['VC-103', 'Two', null],
    ])
    const again = await call(testUserId, 'POST', `${base}/import`, body)
    expect(again.json().data.map((t: any) => t.id)).toEqual(res.json().data.map((t: any) => t.id))
    expect((await call(testUserId, 'GET', base)).json().data).toHaveLength(3)
  })

  it('comments carry the member name, and stay inside the workspace', async () => {
    const { base } = await setup()
    const task = await create(base, { title: 'Discuss' })
    const res = await call(carolId, 'POST', `${base}/${task.id}/comments`, { text: ' Looks good ' })
    expect(res.statusCode).toBe(201)
    await validateResponse('addTaskComment', 201, res.json())
    const list = await call(testUserId, 'GET', `${base}/${task.id}/comments`)
    await validateResponse('listTaskComments', 200, list.json())
    expect(list.json().data).toMatchObject([{ authorName: 'Carol', text: 'Looks good' }])
    expect((await call(testUserId, 'GET', `${base}/${task.id}`)).json().data.commentCount).toBe(1)

    // Another workspace can't reach this task.
    const other = await createWorkspace(app, testUserId, { name: 'Other Co' })
    expect((await call(testUserId, 'GET', `/workspaces/${other.id}/tasks/${task.id}`)).statusCode).toBe(404)
    expect((await call(testUserId, 'POST', `/workspaces/${other.id}/tasks/${task.id}/move`, { status: 'done' })).statusCode).toBe(404)
    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('logs work, credits a member, closes the task in the same change, and deletes by rule', async () => {
    const { ws, base, carol } = await setup()
    const logs = `/workspaces/${ws.id}/work-logs`
    const task = await create(base, { title: 'Ship', status: 'in_progress' })
    const res = await call(carolId, 'POST', logs, { summary: ' Shipped it ', day: '2026-10-09', time: '15:00', memberId: carol, taskId: task.id, completeTask: true, hoursSpent: 2.5 })
    expect(res.statusCode).toBe(201)
    await validateResponse('createWorkLog', 201, res.json())
    expect(res.json().data).toMatchObject({ summary: 'Shipped it', taskKey: task.taskKey, member: { memberId: carol, name: 'Carol' }, category: 'work', hoursSpent: 2.5 })
    const closed = (await call(testUserId, 'GET', `${base}/${task.id}`)).json().data
    expect(closed.status).toBe('done')
    expect(closed.resolvedAt).not.toBeNull()

    const team = await call(testUserId, 'POST', logs, { summary: 'Offsite', day: '2026-10-08', category: 'meeting' })
    expect(team.json().data.memberId).toBeNull()
    const list = await call(carolId, 'GET', logs)
    await validateResponse('listWorkLogs', 200, list.json())
    expect(list.json().data.map((l: any) => l.summary)).toEqual(['Shipped it', 'Offsite'])

    expect((await call(testUserId, 'POST', logs, { summary: 'x', day: '2026-10-09', completeTask: true })).json().code).toBe('INVALID_TASK')
    expect((await call(testUserId, 'POST', logs, { summary: 'x', day: '2026-13-01' })).statusCode).toBe(400)
    expect((await call(testUserId, 'POST', logs, { summary: 'x', day: '2026-10-09', memberId: 'nobody' })).json().code).toBe('INVALID_MEMBER')

    // Carol (a member) can't delete Alice's team entry; Alice (owner) can delete anything; Carol can delete her own.
    expect((await call(carolId, 'DELETE', `${logs}/${team.json().data.id}`)).statusCode).toBe(403)
    expect((await call(carolId, 'DELETE', `${logs}/${res.json().data.id}`)).statusCode).toBe(200)
    expect((await call(testUserId, 'DELETE', `${logs}/${team.json().data.id}`)).statusCode).toBe(200)
    expect((await call(testUserId, 'GET', logs)).json().data).toEqual([])
    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('imports browser entries once, linking task keys that exist', async () => {
    const { ws, base } = await setup()
    const task = await create(base, { title: 'Known' })
    const body = { idempotencyKey: 'local-logs-1', entries: [{ summary: 'Did known', day: '2026-10-01', taskKey: task.taskKey.toLowerCase() }, { summary: 'Old key', day: '2026-10-02', taskKey: 'XX-9', memberId: 'user-1' }] }
    const res = await call(testUserId, 'POST', `/workspaces/${ws.id}/work-logs/import`, body)
    expect(res.statusCode).toBe(201)
    await validateResponse('importWorkLogs', 201, res.json())
    expect(res.json().data.map((l: any) => [l.summary, l.taskId, l.taskKey, l.memberId])).toEqual([
      ['Did known', task.id, task.taskKey, null],
      ['Old key', null, 'XX-9', null],
    ])
    const again = await call(testUserId, 'POST', `/workspaces/${ws.id}/work-logs/import`, body)
    expect(again.json().data.map((l: any) => l.id)).toEqual(res.json().data.map((l: any) => l.id))
  })

  it('WIP limits: everyone reads them, admins set them', async () => {
    const { ws } = await setup()
    const board = `/workspaces/${ws.id}/task-board`
    expect((await call(carolId, 'GET', board)).json().data).toEqual({ wipLimits: {} })
    expect((await call(carolId, 'PUT', board, { wipLimits: { in_progress: 3 } })).statusCode).toBe(403)
    const set = await call(testUserId, 'PUT', board, { wipLimits: { in_progress: 3, in_review: null } })
    await validateResponse('updateTaskBoard', 200, set.json())
    expect(set.json().data).toEqual({ wipLimits: { in_progress: 3 } })
    const read = await call(carolId, 'GET', board)
    await validateResponse('getTaskBoard', 200, read.json())
    expect(read.json().data.wipLimits).toEqual({ in_progress: 3 })
    expect((await call(testUserId, 'PUT', board, { wipLimits: { in_progress: 0 } })).statusCode).toBe(400)
  })
})
