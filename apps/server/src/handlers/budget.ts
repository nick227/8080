import { budgetService } from '../services/BudgetService'

export async function listBudgetItems(request: any, reply: any) {
  const { workspaceId } = request.params
  return reply.send(await budgetService.list(request.user.id, workspaceId, request.query))
}

export async function getBudgetSummary(request: any, reply: any) {
  const { workspaceId } = request.params
  return reply.send({ data: await budgetService.getSummary(request.user.id, workspaceId) })
}

export async function createBudgetItem(request: any, reply: any) {
  const { workspaceId } = request.params
  return reply.status(201).send({ data: await budgetService.create(request.user.id, workspaceId, request.body) })
}

export async function getBudgetItem(request: any, reply: any) {
  const { workspaceId, budgetItemId } = request.params
  return reply.send({ data: await budgetService.get(request.user.id, workspaceId, budgetItemId) })
}

export async function updateBudgetItem(request: any, reply: any) {
  const { workspaceId, budgetItemId } = request.params
  return reply.send({ data: await budgetService.update(request.user.id, workspaceId, budgetItemId, request.body) })
}

export async function deleteBudgetItem(request: any, reply: any) {
  const { workspaceId, budgetItemId } = request.params
  await budgetService.remove(request.user.id, workspaceId, budgetItemId)
  return reply.send({ data: null })
}
