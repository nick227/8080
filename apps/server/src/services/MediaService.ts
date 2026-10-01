import { db, type MediaKind } from '@project/db'
import { randomUUID } from 'crypto'
import { storage } from '../providers/storage'
import { toMedia } from '../lib/serialize'
import { badRequest, httpError } from '../lib/errors'

export const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_SIZE_MB ?? 50) * 1024 * 1024
const MAX_DURATION_S = 3 * 60 * 60

// Allow-list: mime → [extension, kind]. Extension is always derived from here,
// never from the client filename. No SVG/HTML — uploads are served from our origin.
const ALLOWED: Record<string, [string, MediaKind]> = {
  'image/jpeg': ['jpg', 'image'],
  'image/png': ['png', 'image'],
  'image/gif': ['gif', 'image'],
  'image/webp': ['webp', 'image'],
  'audio/webm': ['webm', 'audio'],
  'audio/ogg': ['ogg', 'audio'],
  'audio/mpeg': ['mp3', 'audio'],
  'audio/mp4': ['m4a', 'audio'],
  'audio/aac': ['aac', 'audio'],
  'audio/wav': ['wav', 'audio'],
  'audio/x-wav': ['wav', 'audio'],
  'video/webm': ['webm', 'video'],
  'video/mp4': ['mp4', 'video'],
  'video/quicktime': ['mov', 'video'],
  'application/pdf': ['pdf', 'file'],
}

export type UploadInput = {
  buffer: Buffer
  truncated: boolean
  mimetype: string
  filename?: string
  name?: string
  duration?: string
}

export class MediaService {
  async upload(ownerId: string, input: UploadInput) {
    // MediaRecorder reports e.g. "audio/webm;codecs=opus" — keep the essence only.
    const mimeType = input.mimetype.split(';')[0]!.trim().toLowerCase()
    const allowed = ALLOWED[mimeType]
    if (!allowed) throw httpError(415, `File type ${mimeType || 'unknown'} is not allowed`, 'UNSUPPORTED_TYPE')
    if (input.truncated) {
      throw httpError(413, `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`, 'FILE_TOO_LARGE')
    }
    if (input.buffer.length === 0) throw badRequest('File is empty', 'EMPTY_FILE')

    let duration: number | null = null
    if (input.duration !== undefined && input.duration !== '') {
      duration = Number(input.duration)
      if (!Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION_S) {
        throw badRequest('Invalid duration', 'INVALID_DURATION')
      }
    }

    const [ext, kind] = allowed
    const storageKey = `${randomUUID()}.${ext}`
    await storage().put({ key: storageKey, buffer: input.buffer, mimeType })

    try {
      const media = await db.media.create({
        data: {
          ownerId,
          kind,
          storageKey,
          mimeType,
          size: input.buffer.length,
          duration,
          name: (input.name ?? input.filename)?.slice(0, 255) || null,
        },
      })
      return toMedia(media)
    } catch (err) {
      await storage().delete(storageKey)
      throw err
    }
  }
}
