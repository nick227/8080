import { MediaService, type UploadInput } from '../services/MediaService'
import { badRequest } from '../lib/errors'
import { YouTubeService } from '../services/YouTubeService'

const mediaService = new MediaService()
const youTubeService = new YouTubeService()

// Reads all parts: the web client appends `file` before `type`/`name`/`duration`,
// so request.file() (which only sees fields sent before the file) isn't enough.
export async function uploadMedia(request: any, reply: any) {
  let file: Pick<UploadInput, 'buffer' | 'truncated' | 'mimetype' | 'filename'> | undefined
  const fields: Record<string, string> = {}

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer()
      if (part.fieldname === 'file' && !file) {
        file = { buffer, truncated: part.file.truncated, mimetype: part.mimetype, filename: part.filename }
      }
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value
    }
  }

  if (!file) throw badRequest('Missing "file" field', 'MISSING_FILE')
  const media = await mediaService.upload(request.user.id, { ...file, name: fields.name, duration: fields.duration })
  return reply.status(201).send({ data: media })
}

// External YouTube video: referenced by canonical id, never downloaded.
export async function createYouTubeMedia(request: any, reply: any) {
  const media = await youTubeService.create(request.user.id, request.body)
  return reply.status(201).send({ data: media })
}
