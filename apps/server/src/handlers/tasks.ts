// Calendar / Boards tasks, logged work and board settings.
import { workspaceCtx as ctx } from '../lib/session'
import { TaskService } from '../services/TaskService'
import { WorkLogService } from '../services/WorkLogService'
import { ChecklistService } from '../services/ChecklistService'
import { joinTaskStream, type TaskFrame } from '../services/taskStream'
import { authorize } from '../services/workspacePolicy'

const tasks = new TaskService()

export async function listTasks(request: any, reply: any) {
  return reply.send(await tasks.list(request.user.id, request.params.workspaceId))
}

export async function createTask(request: any, reply: any) {
  return reply.status(201).send({ data: await tasks.create(ctx(request), request.params.workspaceId, request.body) })
}

export async function importTasks(request: any, reply: any) {
  return reply.status(201).send(await tasks.import(ctx(request), request.params.workspaceId, request.body))
}

export async function getTask(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  return reply.send({ data: await tasks.get(request.user.id, workspaceId, taskId) })
}

export async function updateTask(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  return reply.send({ data: await tasks.update(ctx(request), workspaceId, taskId, request.body) })
}

export async function moveTask(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  return reply.send({ data: await tasks.move(ctx(request), workspaceId, taskId, request.body) })
}

export async function deleteTask(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  await tasks.remove(ctx(request), workspaceId, taskId)
  return reply.send({ data: null })
}

export async function restoreTask(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  return reply.send({ data: await tasks.restore(ctx(request), workspaceId, taskId) })
}

export async function listTaskComments(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  return reply.send(await tasks.listComments(request.user.id, workspaceId, taskId))
}

export async function addTaskComment(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  return reply.status(201).send({ data: await tasks.addComment(ctx(request), workspaceId, taskId, request.body) })
}

const workLogs = new WorkLogService()

export async function listWorkLogs(request: any, reply: any) {
  return reply.send(await workLogs.list(request.user.id, request.params.workspaceId))
}

export async function createWorkLog(request: any, reply: any) {
  return reply.status(201).send({ data: await workLogs.create(ctx(request), request.params.workspaceId, request.body) })
}

export async function importWorkLogs(request: any, reply: any) {
  return reply.status(201).send(await workLogs.import(ctx(request), request.params.workspaceId, request.body))
}

export async function deleteWorkLog(request: any, reply: any) {
  await workLogs.remove(ctx(request), request.params.workspaceId, request.params.workLogId)
  return reply.send({ data: null })
}

export async function getTaskBoard(request: any, reply: any) {
  return reply.send({ data: await workLogs.board(request.user.id, request.params.workspaceId) })
}

export async function updateTaskBoard(request: any, reply: any) {
  return reply.send({ data: await workLogs.setBoard(ctx(request), request.params.workspaceId, request.body) })
}

export async function blockTask(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  return reply.send({ data: await tasks.block(ctx(request), workspaceId, taskId, request.body) })
}

export async function unblockTask(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  return reply.send({ data: await tasks.unblock(ctx(request), workspaceId, taskId) })
}

export async function listTaskActivity(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  return reply.send(await tasks.activity(request.user.id, workspaceId, taskId))
}

/**
 * Live board updates (SSE). Frames carry `id:` so the browser's automatic reconnect
 * sends Last-Event-ID; `?after=` does the same for a client that reopens the stream.
 * First frame: `ready` with `replayed` (false = reconcile with one list fetch).
 */
export async function streamTasks(request: any, reply: any) {
  const { workspaceId } = request.params
  await authorize(request.user.id, workspaceId, 'task.read')
  const lastEventId = (request.headers['last-event-id'] as string | undefined) ?? (request.query?.after as string | undefined) ?? null
  reply.hijack()
  reply.raw.writeHead(200, {
    ...reply.getHeaders(),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  let closed = false
  const write = (chunk: string) => {
    if (closed) return
    if (!reply.raw.write(chunk)) request.raw.destroy()
  }
  const frame = (f: TaskFrame) => write(`id: ${f.id}\nevent: ${f.event}\ndata: ${JSON.stringify({ event: f.event, ...f.data })}\n\n`)
  const joined = joinTaskStream(workspaceId, lastEventId, frame)
  write('retry: 2000\n\n')
  write(`id: ${joined.current}\nevent: ready\ndata: ${JSON.stringify({ event: 'ready', replayed: joined.replay !== null })}\n\n`)
  for (const f of joined.replay ?? []) frame(f)
  const heartbeat = setInterval(() => write(': ping\n\n'), 25_000)
  request.raw.on('close', () => {
    closed = true
    clearInterval(heartbeat)
    joined.leave()
  })
}

export async function bulkTasks(request: any, reply: any) {
  return reply.send(await tasks.bulk(ctx(request), request.params.workspaceId, request.body))
}

const checklist = new ChecklistService()

export async function listTaskChecklist(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  return reply.send(await checklist.list(request.user.id, workspaceId, taskId))
}

export async function addChecklistItem(request: any, reply: any) {
  const { workspaceId, taskId } = request.params
  return reply.status(201).send({ data: await checklist.add(ctx(request), workspaceId, taskId, request.body) })
}

export async function updateChecklistItem(request: any, reply: any) {
  const { workspaceId, taskId, itemId } = request.params
  return reply.send({ data: await checklist.update(ctx(request), workspaceId, taskId, itemId, request.body) })
}

export async function deleteChecklistItem(request: any, reply: any) {
  const { workspaceId, taskId, itemId } = request.params
  await checklist.remove(ctx(request), workspaceId, taskId, itemId)
  return reply.send({ data: null })
}
