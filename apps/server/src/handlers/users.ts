import { UserService } from '../services/UserService'
import { toUser } from '../lib/serialize'

const userService = new UserService()

export async function updateCurrentUser(request: any, reply: any) {
  const user = await userService.updateMe(request.user.id, request.body)
  return reply.send({ data: toUser(user) })
}
