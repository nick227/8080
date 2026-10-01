import { createWriteStream, mkdirSync } from 'fs'
import { open, unlink } from 'fs/promises'
import { resolve } from 'path'
import type { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { badRequest } from '../lib/errors'
import { SAFE_KEY, type ByteRange, type StorageProvider } from './storage'

// Dev storage: files under apps/server/uploads/ (gitignored). Tests point UPLOADS_DIR
// at a temp dir so they don't fill the dev folder.
export const UPLOADS_DIR = resolve(process.env.UPLOADS_DIR ?? resolve(__dirname, '../../uploads'))

function pathFor(key: string) {
  if (!SAFE_KEY.test(key)) throw badRequest('Invalid key')
  return resolve(UPLOADS_DIR, key)
}

export class LocalStorageProvider implements StorageProvider {
  constructor() {
    mkdirSync(UPLOADS_DIR, { recursive: true })
  }

  async put({ key, body }: { key: string; body: Readable }) {
    const path = pathFor(key)
    try {
      await pipeline(body, createWriteStream(path))
    } catch (err) {
      await unlink(path).catch(() => {}) // never leave a partial file behind
      throw err
    }
  }

  async read(key: string, range?: ByteRange) {
    // Open first so a missing file is a null here, not an error mid-response.
    const file = await open(pathFor(key), 'r').catch((err) => {
      if (err.code === 'ENOENT') return null
      throw err
    })
    return file?.createReadStream(range ? { start: range.start, end: range.end } : {}) ?? null
  }

  async delete(key: string) {
    await unlink(pathFor(key)).catch(() => {})
  }
}
