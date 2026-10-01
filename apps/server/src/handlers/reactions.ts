import { ReactionService } from '../services/ReactionService'

const reactionService = new ReactionService()

export async function addReaction(request: any, reply: any) {
  const { itemId, type } = request.params
  return reply.send({ data: await reactionService.add(request.user.id, itemId, type) })
}

export async function removeReaction(request: any, reply: any) {
  const { itemId, type } = request.params
  return reply.send({ data: await reactionService.remove(request.user.id, itemId, type) })
}
