import { MediaService, type StoredFile } from '../services/MediaService'
import { badRequest } from '../lib/errors'
import { YouTubeService } from '../services/YouTubeService'

const mediaService = new MediaService()
const youTubeService = new YouTubeService()

// Streams the upload straight into storage. The web client appends `file` before
// `type`/`name`/`duration`, so the file is stored first and the fields read after it;
// the Media row is created once all parts are in. Any failure removes the object.
export async function uploadMedia(request: any, reply: any) {
  let stored: StoredFile | undefined
  const fields: Record<string, string> = {}

  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname === 'file' && !stored) stored = await mediaService.store(part)
        else part.file.resume() // not ours: drain it
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value
      }
    }
    if (!stored) throw badRequest('Missing "file" field', 'MISSING_FILE')
    const media = await mediaService.create(request.user.id, stored, { name: fields.name, duration: fields.duration })
    return reply.status(201).send({ data: media })
  } catch (err) {
    if (stored) await mediaService.discard(stored)
    throw err
  }
}

// External YouTube video: referenced by canonical id, never downloaded.
export async function createYouTubeMedia(request: any, reply: any) {
  const media = await youTubeService.create(request.user.id, request.body)
  return reply.status(201).send({ data: media })
}
