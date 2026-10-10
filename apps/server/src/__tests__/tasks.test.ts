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

  it('history: every change to a task is one recorded line, with names kept at the time', async () => {
    const { base, carol } = await setup()
    const task = await create(base, { title: 'Plan' })
    await call(testUserId, 'PATCH', `${base}/${task.id}`, { assigneeMemberId: carol, priority: 'high', description: 'secret details' })
    await call(testUserId, 'POST', `${base}/${task.id}/move`, { status: 'in_progress' })
    await call(carolId, 'POST', `${base}/${task.id}/block`, { reason: 'Waiting on legal' })
    await call(carolId, 'POST', `${base}/${task.id}/unblock`)
    await call(carolId, 'POST', `${base}/${task.id}/comments`, { text: 'Done with legal' })
    const res = await call(carolId, 'GET', `${base}/${task.id}/activity`)
    await validateResponse('listTaskActivity', 200, res.json())
    const lines = res.json().data
    expect(lines.map((a: any) => a.type)).toEqual(['task.created', 'task.assigned', 'task.updated', 'task.moved', 'task.blocked', 'task.unblocked', 'task.commented'])
    expect(lines.every((a: any) => a.taskId === task.id)).toBe(true)
    expect(lines[1].summary).toMatchObject({ toName: 'Carol', to: carol })
    expect(lines[2].summary.changes).toEqual({ description: [null, null], priority: ['medium', 'high'] })
    expect(lines[3].summary).toMatchObject({ from: 'open', to: 'in_progress' })
    expect(lines[4].actor.name).toBe('Carol')
    expect(lines[5].summary.reason).toBe('Waiting on legal')
  })

  it('blocked is a flag with a reason on top of the status', async () => {
    const { base } = await setup()
    const task = await create(base, { title: 'Ship', status: 'in_progress' })
    expect((await call(testUserId, 'POST', `${base}/${task.id}/block`, { reason: '  ' })).statusCode).toBe(400)
    const blocked = await call(testUserId, 'POST', `${base}/${task.id}/block`, { reason: 'Vendor API down' })
    await validateResponse('blockTask', 200, blocked.json())
    expect(blocked.json().data).toMatchObject({ status: 'in_progress', blocked: { reason: 'Vendor API down', byName: 'Alice' } })
    const since = blocked.json().data.blocked.since
    const again = await call(testUserId, 'POST', `${base}/${task.id}/block`, { reason: 'Vendor still down' })
    expect(again.json().data.blocked).toMatchObject({ reason: 'Vendor still down', since })
    // Moving keeps the flag; unblocking clears it.
    expect((await call(testUserId, 'POST', `${base}/${task.id}/move`, { status: 'in_review' })).json().data.blocked.reason).toBe('Vendor still down')
    const cleared = await call(testUserId, 'POST', `${base}/${task.id}/unblock`)
    await validateResponse('unblockTask', 200, cleared.json())
    expect(cleared.json().data.blocked).toBeNull()
    expect((await call(testUserId, 'POST', `${base}/${task.id}/unblock`)).json().data.blocked).toBeNull()
  })

  it('notifications go to the people a task concerns, never to the actor, from the same events', async () => {
    const { ws, base, carol } = await setup()
    const dave = await join(app, ws.id, daveId, 'dave@test.local')
    const inbox = async (userId: string) => (await call(userId, 'GET', `/workspaces/${ws.id}/inbox`)).json().data.filter((i: any) => i.sourceType === 'task')

    // Alice creates for Carol: Carol hears, Alice doesn't.
    const task = await create(base, { title: 'Draft contract', assigneeMemberId: carol })
    let carolInbox = await inbox(carolId)
    expect(carolInbox).toHaveLength(1)
    expect(carolInbox[0]).toMatchObject({ type: 'task', sourceId: task.id, title: `Alice assigned you ${task.taskKey}`, summary: 'Draft contract', unread: true })
    expect(await inbox(testUserId)).toEqual([])

    // Carol blocks it: Alice (creator) hears with the reason.
    await call(carolId, 'POST', `${base}/${task.id}/block`, { reason: 'Need the signed NDA' })
    const alice1 = await inbox(testUserId)
    expect(alice1[0]).toMatchObject({ title: `Carol marked ${task.taskKey} blocked`, summary: 'Draft contract: Need the signed NDA' })

    // Alice mentions Dave: Dave gets "mentioned you", Carol gets "commented on".
    await call(testUserId, 'POST', `${base}/${task.id}/comments`, { text: '@Dave can you chase the NDA?' })
    expect((await inbox(daveId))[0].title).toBe(`Alice mentioned you on ${task.taskKey}`)
    expect((await inbox(carolId))[0].title).toBe(`Alice commented on ${task.taskKey}`)

    // Dave comments: he is now a participant; moves to review notify creator + assignee.
    await call(daveId, 'POST', `${base}/${task.id}/comments`, { text: 'On it' })
    await call(carolId, 'POST', `${base}/${task.id}/move`, { status: 'in_review' })
    expect((await inbox(testUserId))[0].title).toBe(`Carol moved ${task.taskKey} to In review`)
    // A plain move to In progress tells nobody.
    const before = (await inbox(testUserId)).length
    await call(carolId, 'POST', `${base}/${task.id}/move`, { status: 'in_progress' })
    expect((await inbox(testUserId)).length).toBe(before)

    // Reassigning to Dave notifies Dave only.
    const daveBefore = (await inbox(daveId)).length
    await call(testUserId, 'PATCH', `${base}/${task.id}`, { assigneeMemberId: dave })
    const daveInbox = await inbox(daveId)
    expect(daveInbox.length).toBe(daveBefore + 1)
    expect(daveInbox[0].title).toBe(`Alice assigned you ${task.taskKey}`)
    // The inbox can be narrowed to task notifications server-side.
    const only = await call(daveId, 'GET', `/workspaces/${ws.id}/inbox?sourceType=task`)
    await validateResponse('listInboxItems', 200, only.json())
    expect(only.json().data.every((i: any) => i.sourceType === 'task')).toBe(true)
    expect(only.json().data.length).toBe(daveInbox.length)
    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('mentions: full names, unique first names, and no false matches', async () => {
    const { mentionedIn } = await import('../services/TaskService')
    const people = [{ id: 'a', name: 'Ana Lopez' }, { id: 'b', name: 'Ana Ruiz' }, { id: 'c', name: 'Bo' }]
    expect(mentionedIn('@ana lopez please', people)).toEqual(['a'])
    expect(mentionedIn('@Ana please', people)).toEqual([]) // two Anas: ambiguous
    expect(mentionedIn('ping @Bo.', people)).toEqual(['c'])
    expect(mentionedIn('mail bo@x.com and @Bob', people)).toEqual([])
  })

  it('bulk: one change to many tasks, all or nothing, one history line each', async () => {
    const { ws, base, carol } = await setup()
    const a = await create(base, { title: 'A' })
    const b = await create(base, { title: 'B' })
    const c = await create(base, { title: 'C' })
    await create(base, { title: 'Already in progress', status: 'in_progress' })

    const res = await call(testUserId, 'POST', `${base}/bulk`, { ids: [c.id, a.id], action: 'update', patch: { status: 'in_progress', assigneeMemberId: carol, priority: 'high' } })
    expect(res.statusCode).toBe(200)
    await validateResponse('bulkTasks', 200, res.json())
    expect(res.json().data.every((t: any) => t.status === 'in_progress' && t.assigneeMemberId === carol && t.priority === 'high')).toBe(true)
    // Board order is kept at the bottom of the new column: A was above C.
    expect(await column(base, 'in_progress')).toEqual(['Already in progress', 'A', 'C'])
    expect(await column(base, 'open')).toEqual(['B'])

    // Each task has its own history and Carol got one notice per assignment.
    const hist = (await call(testUserId, 'GET', `${base}/${a.id}/activity`)).json().data.map((x: any) => x.type)
    expect(hist).toEqual(['task.created', 'task.moved', 'task.assigned', 'task.updated'])
    const inbox = (await call(carolId, 'GET', `/workspaces/${ws.id}/inbox?sourceType=task`)).json().data
    expect(inbox.filter((i: any) => i.title.includes('assigned you'))).toHaveLength(2)

    // Block and unblock together.
    const blocked = await call(testUserId, 'POST', `${base}/bulk`, { ids: [a.id, b.id], action: 'update', patch: { blocked: { reason: 'Waiting on vendor' } } })
    expect(blocked.json().data.map((t: any) => t.blocked?.reason)).toEqual(['Waiting on vendor', 'Waiting on vendor'])
    const cleared = await call(testUserId, 'POST', `${base}/bulk`, { ids: [a.id, b.id], action: 'update', patch: { blocked: null } })
    expect(cleared.json().data.every((t: any) => t.blocked === null)).toBe(true)

    // A bad id fails everything; nothing changes.
    const bad = await call(testUserId, 'POST', `${base}/bulk`, { ids: [b.id, 'nope'], action: 'update', patch: { priority: 'low' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().code).toBe('INVALID_SELECTION')
    expect((await call(testUserId, 'GET', `${base}/${b.id}`)).json().data.priority).toBe('medium')
    expect((await call(testUserId, 'POST', `${base}/bulk`, { ids: [b.id], action: 'update', patch: {} })).json().code).toBe('EMPTY_PATCH')

    // Delete many, then undo.
    expect((await call(carolId, 'POST', `${base}/bulk`, { ids: [a.id, b.id], action: 'delete' })).json().data).toEqual([])
    expect(await column(base, 'open')).toEqual([])
    const back = await call(carolId, 'POST', `${base}/bulk`, { ids: [a.id, b.id], action: 'restore' })
    expect(back.json().data.map((t: any) => t.title).sort()).toEqual(['A', 'B'])
    expect(await column(base, 'open')).toEqual(['B'])
  })

  it('subtasks: one level, parent history notes them, delete takes them along and restore brings them back', async () => {
    const { base } = await setup()
    const parent = await create(base, { title: 'Launch' })
    const child = await create(base, { title: 'Write copy', parentTaskId: parent.id })
    expect(child.parentTaskId).toBe(parent.id)
    await validateResponse('createTask', 201, { data: child })

    // One level only, no self-parenting, and a parent can't become a subtask.
    expect((await call(testUserId, 'POST', base, { title: 'x', parentTaskId: child.id })).json().code).toBe('INVALID_PARENT')
    expect((await call(testUserId, 'PATCH', `${base}/${parent.id}`, { parentTaskId: parent.id })).json().code).toBe('INVALID_PARENT')
    const other = await create(base, { title: 'Other' })
    expect((await call(testUserId, 'PATCH', `${base}/${parent.id}`, { parentTaskId: other.id })).json().code).toBe('INVALID_PARENT')

    const parentHistory = (await call(testUserId, 'GET', `${base}/${parent.id}/activity`)).json().data.map((a: any) => a.type)
    expect(parentHistory).toEqual(['task.created', 'task.subtask.added'])

    // Re-parent the child onto Other, then make it standalone.
    const moved = await call(testUserId, 'PATCH', `${base}/${child.id}`, { parentTaskId: other.id })
    expect(moved.json().data.parentTaskId).toBe(other.id)
    expect((await call(testUserId, 'GET', `${base}/${parent.id}/activity`)).json().data.at(-1).type).toBe('task.subtask.removed')
    expect((await call(testUserId, 'PATCH', `${base}/${child.id}`, { parentTaskId: null })).json().data.parentTaskId).toBeNull()

    // Delete takes live subtasks along; restore brings back exactly those.
    const a = await create(base, { title: 'Sub A', parentTaskId: parent.id })
    const b = await create(base, { title: 'Sub B', parentTaskId: parent.id })
    await call(testUserId, 'DELETE', `${base}/${b.id}`) // deleted earlier, on its own
    await call(testUserId, 'DELETE', `${base}/${parent.id}`)
    const live = (await call(testUserId, 'GET', base)).json().data.map((t: any) => t.title)
    expect(live).not.toContain('Launch')
    expect(live).not.toContain('Sub A')
    await call(testUserId, 'POST', `${base}/${parent.id}/restore`)
    const back = (await call(testUserId, 'GET', base)).json().data.map((t: any) => t.title)
    expect(back).toContain('Launch')
    expect(back).toContain('Sub A')
    expect(back).not.toContain('Sub B') // it wasn't deleted with the parent
    expect(a.parentTaskId).toBe(parent.id)
  })

  it('checklist: add, check, rename, reorder, remove; progress on the task; history lines', async () => {
    const { base } = await setup()
    const task = await create(base, { title: 'Ship' })
    const cl = `${base}/${task.id}/checklist`
    const one = await call(testUserId, 'POST', cl, { text: ' Draft ' })
    expect(one.statusCode).toBe(201)
    await validateResponse('addChecklistItem', 201, one.json())
    const two = (await call(testUserId, 'POST', cl, { text: 'Review' })).json().data
    const zero = (await call(testUserId, 'POST', cl, { text: 'Plan', beforeItemId: one.json().data.id })).json().data
    const list = await call(carolId, 'GET', cl)
    await validateResponse('listTaskChecklist', 200, list.json())
    expect(list.json().data.map((i: any) => i.text)).toEqual(['Plan', 'Draft', 'Review'])

    const checked = await call(carolId, 'PATCH', `${cl}/${zero.id}`, { done: true })
    await validateResponse('updateChecklistItem', 200, checked.json())
    expect(checked.json().data).toMatchObject({ done: true, doneByName: 'Carol' })
    const t1 = (await call(testUserId, 'GET', `${base}/${task.id}`)).json().data
    expect(t1.checklist).toEqual({ done: 1, total: 3 })

    await call(testUserId, 'PATCH', `${cl}/${two.id}`, { text: 'Review with legal', afterItemId: zero.id })
    expect((await call(testUserId, 'GET', cl)).json().data.map((i: any) => i.text)).toEqual(['Plan', 'Review with legal', 'Draft'])
    expect((await call(testUserId, 'DELETE', `${cl}/${one.json().data.id}`)).statusCode).toBe(200)
    const t2 = (await call(testUserId, 'GET', `${base}/${task.id}`)).json().data
    expect(t2.checklist).toEqual({ done: 1, total: 2 })
    expect(t2.version).toBeGreaterThan(t1.version)

    const types = (await call(testUserId, 'GET', `${base}/${task.id}/activity`)).json().data.map((a: any) => a.type)
    expect(types).toEqual(['task.created', 'task.checklist.added', 'task.checklist.added', 'task.checklist.added', 'task.checklist.checked', 'task.checklist.edited', 'task.checklist.removed'])
    expect((await call(testUserId, 'POST', cl, { text: '  ' })).statusCode).toBe(400)
    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('placing with one neighbour lands right next to it, not past the next card', async () => {
    const { base } = await setup()
    const a = await create(base, { title: 'A' })
    await create(base, { title: 'B' })
    const c = await create(base, { title: 'C' })
    await call(testUserId, 'POST', `${base}/${c.id}/move`, { status: 'open', afterTaskId: a.id })
    expect(await column(base, 'open')).toEqual(['A', 'C', 'B'])
    const d = await create(base, { title: 'D', beforeTaskId: c.id })
    expect(d.title).toBe('D')
    expect(await column(base, 'open')).toEqual(['A', 'D', 'C', 'B'])
  })
})
