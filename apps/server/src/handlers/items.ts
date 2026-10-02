import { ItemService } from '../services/ItemService'

const itemService = new ItemService()

export async function listRoomItems(request: any, reply: any) {
  return reply.send(await itemService.list(request.user.id, request.params.roomId, request.query))
}



export async function sendMessage(request: any, reply: any) {
  const item = await itemService.send(request.user.id, request.params.roomId, request.body)
  return reply.status(201).send({ data: item })
}

export async function replyToItem(request: any, reply: any) {
  const item = await itemService.reply(request.user.id, request.params.itemId, request.body)
  return reply.status(201).send({ data: item })
}

export async function getItem(request: any, reply: any) {
  return reply.send({ data: await itemService.get(request.user.id, request.params.itemId) })
}

export async function deleteItem(request: any, reply: any) {
  return reply.send({ data: await itemService.delete(request.user.id, request.params.itemId) })
}
