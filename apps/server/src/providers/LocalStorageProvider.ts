import { writeFile, unlink } from 'fs/promises'
import { mkdirSync } from 'fs'
import { resolve } from 'path'

// Files live in apps/server/uploads/ (gitignored) and are served at /uploads/ by plugins/uploads.ts.
export const UPLOADS_DIR = resolve(__dirname, '../../uploads')
const BASE_URL = (process.env.PUBLIC_UPLOAD_BASE_URL ?? 'http://localhost:3001/uploads').replace(/\/$/, '')

// Keys are generated server-side as `<uuid>.<ext>`; anything else is rejected.
const SAFE_KEY = /^[a-f0-9-]{36}\.[a-z0-9]{2,5}$/

export class LocalStorageProvider {
  constructor() {
    mkdirSync(UPLOADS_DIR, { recursive: true })
  }

  async put({ key, buffer }: { key: string; buffer: Buffer }) {
    if (!SAFE_KEY.test(key)) throw { statusCode: 400, message: 'Invalid key' }
    await writeFile(resolve(UPLOADS_DIR, key), buffer)
  }

  async delete(key: string) {
    if (!SAFE_KEY.test(key)) throw { statusCode: 400, message: 'Invalid key' }
    // Idempotent: silently succeed if already gone.
    await unlink(resolve(UPLOADS_DIR, key)).catch(() => {})
  }

  urlFor(key: string) {
    return `${BASE_URL}/${key}`
  }
}
