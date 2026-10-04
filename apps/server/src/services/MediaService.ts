import { db, type MediaKind } from '@project/db'
import { randomUUID } from 'crypto'
import { Transform, type Readable } from 'stream'
import { storage } from '../providers/storage'
import { toMedia } from '../lib/serialize'
import { badRequest, httpError } from '../lib/errors'
import { MAX_UPLOAD_MB } from '@project/shared'

export const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_SIZE_MB ?? MAX_UPLOAD_MB) * 1024 * 1024
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
    // Hold the first bytes back until the signature can be checked: nothing reaches
    // storage before it passes, however the client chunks the upload.
    let head: Buffer[] = []
    let headLength = 0
    let verified = false
    const release = (push: (chunk: Buffer) => void) => {
      const bytes = Buffer.concat(head)
      head = []
      if (!matchesSignature(bytes, mimeType)) return httpError(415, `File content does not match ${mimeType}`, 'UNSUPPORTED_TYPE') as unknown as Error
      verified = true
      push(bytes)
      return null
    }

    const counted = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length
        if (verified) return done(null, chunk)
        head.push(chunk)
        headLength += chunk.length
        if (headLength < SIGNATURE_BYTES) return done()
        done(release((bytes) => this.push(bytes)) ?? undefined)
      },
      // A file shorter than SIGNATURE_BYTES is checked on what there is.
      flush(done) {
        if (verified || headLength === 0) return done()
        done(release((bytes) => this.push(bytes)) ?? undefined)
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

// Enough leading bytes for every signature below.
const SIGNATURE_BYTES = 32

const ascii = (b: Buffer, start: number, end: number) => b.toString('latin1', start, end)
const riff = (b: Buffer, format: string) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === format
const isoMedia = (b: Buffer) => ascii(b, 4, 8) === 'ftyp'
const ebml = (b: Buffer) => b.toString('hex', 0, 4) === '1a45dfa3'
const mpegSync = (b: Buffer) => b[0] === 0xff && (b[1]! & 0xe0) === 0xe0
const adtsSync = (b: Buffer) => b[0] === 0xff && (b[1]! & 0xf6) === 0xf0

// The bytes must look like the declared type — every allowed type has a check, and
// anything else (including a file too short to tell) is rejected.
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.toString('hex', 0, 8) === '89504e470d0a1a0a',
  'image/gif': (b) => ascii(b, 0, 4) === 'GIF8',
  'image/webp': (b) => riff(b, 'WEBP'),
  'audio/webm': ebml,
  'video/webm': ebml,
  'audio/ogg': (b) => ascii(b, 0, 4) === 'OggS',
  'audio/mpeg': (b) => ascii(b, 0, 3) === 'ID3' || mpegSync(b),
  'audio/mp4': isoMedia,
  'video/mp4': isoMedia,
  'video/quicktime': (b) => isoMedia(b) || ['moov', 'mdat', 'wide', 'free'].includes(ascii(b, 4, 8)),
  'audio/aac': adtsSync,
  'audio/wav': (b) => riff(b, 'WAVE'),
  'audio/x-wav': (b) => riff(b, 'WAVE'),
  'application/pdf': (b) => ascii(b, 0, 5) === '%PDF-',
}

export function matchesSignature(bytes: Buffer, mimeType: string): boolean {
  const check = SIGNATURES[mimeType]
  return !!check && bytes.length >= 4 && check(bytes)
}
