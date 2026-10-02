import { UserService } from '../services/UserService'
import { MediaService, type StoredFile } from '../services/MediaService'
import { toUser } from '../lib/serialize'
import { badRequest, forbidden } from '../lib/errors'

const userService = new UserService()
const mediaService = new MediaService()

export async function updateCurrentUser(request: any, reply: any) {
  const user = await userService.updateMe(request.user.id, request.body)
  return reply.send({ data: toUser(user) })
}

// Image only. The previous avatar object is removed once the profile points at the new one.
export async function uploadAvatar(request: any, reply: any) {
  if (request.user.isGuest) throw forbidden('Sign in to set an avatar')

  let stored: StoredFile | undefined
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname === 'file' && !stored) stored = await mediaService.store(part)
        else part.file.resume()
      }
    }
    if (!stored) throw badRequest('Missing "file" field', 'MISSING_FILE')
    const user = await userService.replaceAvatar(request.user.id, stored)
    stored = undefined
    return reply.send({ data: toUser(user) })
  } catch (err) {
    if (stored) await mediaService.discard(stored)
    throw err
  }
}
