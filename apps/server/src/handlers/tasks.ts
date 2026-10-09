// Calendar / Boards tasks.
import { workspaceCtx as ctx } from '../lib/session'
import { TaskService } from '../services/TaskService'

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
