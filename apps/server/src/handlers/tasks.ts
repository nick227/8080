// Calendar / Boards tasks, logged work and board settings.
import { workspaceCtx as ctx } from '../lib/session'
import { TaskService } from '../services/TaskService'
import { WorkLogService } from '../services/WorkLogService'

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
