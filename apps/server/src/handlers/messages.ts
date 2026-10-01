import { ItemService } from '../services/ItemService'

const itemService = new ItemService()

export async function shareMessageToRooms(request: any, reply: any) {
  const items = await itemService.share(request.user.id, request.params.messageId, request.body.roomIds)
  return reply.status(201).send({ data: items })
}
