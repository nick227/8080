import { db, type MediaKind } from '@project/db'
import { randomUUID } from 'crypto'
import { Transform, type Readable } from 'stream'
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

// A multipart file part, consumed as a stream (see handlers/media.ts).
export type IncomingFile = {
  file: Readable & { truncated?: boolean }
  mimetype: string
  filename?: string
}

// Bytes already in storage, not yet recorded in the database.
export type StoredFile = { key: string; mimeType: string; kind: MediaKind; size: number; filename?: string }

const tooLarge = () => httpError(413, `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`, 'FILE_TOO_LARGE')

export class MediaService {
  // Streams the file into storage, counting bytes as they pass — never buffered whole.
  async store(input: IncomingFile): Promise<StoredFile> {
    // MediaRecorder reports e.g. "audio/webm;codecs=opus" — keep the essence only.
    const mimeType = input.mimetype.split(';')[0]!.trim().toLowerCase()
    const allowed = ALLOWED[mimeType]
    if (!allowed) {
      input.file.resume() // drain so the request can finish
      throw httpError(415, `File type ${mimeType || 'unknown'} is not allowed`, 'UNSUPPORTED_TYPE')
    }

    const [ext, kind] = allowed
    const key = `${randomUUID()}.${ext}`
    let size = 0
    let checkedMagic = false
    let headerBuffer = Buffer.alloc(0)

    const counted = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        if (!checkedMagic) {
          headerBuffer = Buffer.concat([headerBuffer, chunk])
          if (headerBuffer.length >= 32 || headerBuffer.length >= size + chunk.length) { // Wait for 32 bytes or EOF
            if (!checkMagicBytes(headerBuffer, mimeType)) {
              return done(httpError(415, `File content does not match ${mimeType}`, 'UNSUPPORTED_TYPE') as unknown as Error)
            }
            checkedMagic = true
            // we don't clear headerBuffer to save memory because it's small anyway
          }
        }
        size += chunk.length
        done(null, chunk)
      },
    })
    // Over the size limit, @fastify/multipart errors the file stream; pass that on.
    input.file.once('error', (err) => counted.destroy(err))

    try {
      await storage().put({ key, body: input.file.pipe(counted), mimeType })
    } catch (err: any) {
      await storage().delete(key)
      throw err?.code === 'FST_REQ_FILE_TOO_LARGE' || input.file.truncated ? tooLarge() : err
    }
    if (input.file.truncated) {
      await storage().delete(key)
      throw tooLarge()
    }
    if (size === 0) {
      await storage().delete(key)
      throw badRequest('File is empty', 'EMPTY_FILE')
    }
    return { key, mimeType, kind, size, filename: input.filename }
  }

  // Records stored bytes as Media. The caller discards the object if this throws.
  async create(ownerId: string, stored: StoredFile, fields: { name?: string; duration?: string }) {
    let duration: number | null = null
    if (fields.duration !== undefined && fields.duration !== '') {
      duration = Number(fields.duration)
      if (!Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION_S) {
        throw badRequest('Invalid duration', 'INVALID_DURATION')
      }
    }

    const media = await db.media.create({
      data: {
        ownerId,
        kind: stored.kind,
        storageKey: stored.key,
        mimeType: stored.mimeType,
        size: stored.size,
        duration,
        name: (fields.name ?? stored.filename)?.slice(0, 255) || null,
      },
    })
    return toMedia(media)
  }

  discard(stored: StoredFile) {
    return storage().delete(stored.key)
  }
}

function checkMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 8) return true // too small to check reliably here
  
  if (mimeType === 'image/jpeg') return buffer[0]! === 0xFF && buffer[1]! === 0xD8 && buffer[2]! === 0xFF
  if (mimeType === 'image/png') return buffer.toString('hex', 0, 8) === '89504e470d0a1a0a'
  if (mimeType === 'image/gif') return buffer.toString('utf8', 0, 4).startsWith('GIF8')
  if (mimeType === 'application/pdf') return buffer.toString('utf8', 0, 5) === '%PDF-'
  if (mimeType === 'audio/webm' || mimeType === 'video/webm') return buffer.toString('hex', 0, 4) === '1a45dfa3'
  if (mimeType === 'audio/ogg') return buffer.toString('utf8', 0, 4) === 'OggS'
  
  // RIFF-based (WebP, WAV)
  if (buffer.toString('utf8', 0, 4) === 'RIFF') {
    const format = buffer.toString('utf8', 8, 12)
    if (mimeType === 'image/webp') return format === 'WEBP'
    if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') return format === 'WAVE'
    return false
  }
  
  // ftyp-based (MP4, M4A, MOV)
  if (buffer.toString('utf8', 4, 8) === 'ftyp') {
    return mimeType === 'video/mp4' || mimeType === 'audio/mp4' || mimeType === 'video/quicktime'
  }
  
  // MP3: either ID3 tag or MPEG sync word
  if (mimeType === 'audio/mpeg') {
    return buffer.toString('utf8', 0, 3) === 'ID3' || (buffer[0]! === 0xFF && (buffer[1]! & 0xE0) === 0xE0)
  }
  
  // AAC ADTS: sync word
  if (mimeType === 'audio/aac') {
    return buffer[0]! === 0xFF && (buffer[1]! & 0xF0) === 0xF0
  }
  
  // If we don't have a specific check, allow it (but we covered all our ALLOWED types)
  return true
}
