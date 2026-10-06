// Inventory catalog and contact interests.
import { InventoryService } from '../services/InventoryService'

const inventory = new InventoryService()

export async function listInventory(request: any, reply: any) {
  return reply.send(await inventory.list(request.user.id, request.params.workspaceId, request.query))
}

export async function createInventoryItem(request: any, reply: any) {
  return reply.status(201).send({ data: await inventory.create(request.user.id, request.params.workspaceId, request.body) })
}

export async function getInventoryItem(request: any, reply: any) {
  const { workspaceId, inventoryId } = request.params
  return reply.send({ data: await inventory.get(request.user.id, workspaceId, inventoryId) })
}

export async function updateInventoryItem(request: any, reply: any) {
  const { workspaceId, inventoryId } = request.params
  return reply.send({ data: await inventory.update(request.user.id, workspaceId, inventoryId, request.body) })
}

export async function deleteInventoryItem(request: any, reply: any) {
  const { workspaceId, inventoryId } = request.params
  await inventory.remove(request.user.id, workspaceId, inventoryId)
  return reply.send({ data: null })
}

export async function listContactInterests(request: any, reply: any) {
  const { workspaceId, contactId } = request.params
  return reply.send(await inventory.listInterests(request.user.id, workspaceId, contactId))
}

export async function addContactInterest(request: any, reply: any) {
  const { workspaceId, contactId } = request.params
  return reply.status(201).send({ data: await inventory.addInterest(request.user.id, workspaceId, contactId, request.body.inventoryId) })
}

export async function removeContactInterest(request: any, reply: any) {
  const { workspaceId, contactId, inventoryId } = request.params
  await inventory.removeInterest(request.user.id, workspaceId, contactId, inventoryId)
  return reply.send({ data: null })
}
