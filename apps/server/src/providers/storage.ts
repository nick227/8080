import type { Readable } from 'stream'
import { LocalStorageProvider } from './LocalStorageProvider'
import { S3StorageProvider } from './S3StorageProvider'

// Storage provider interface — all providers implement this shape. Bytes stream in
// and out; nothing holds a whole file in memory.
//
// Every provider is served by the API at /uploads/<key> (plugins/uploads.ts), so
// media URLs, CORS (ACAO for crossOrigin="anonymous" audio) and the nosniff/CSP
// headers are identical in dev and prod. Railway buckets are private: no public
// bucket URLs exist to hand out instead.

// Inclusive byte range, already resolved against the object's size.
export type ByteRange = { start: number; end: number }

export interface StorageProvider {
  put(options: { key: string; body: Readable; mimeType: string }): Promise<void>
  // The object (or the range), or null when it doesn't exist.
  read(key: string, range?: ByteRange): Promise<Readable | null>
  // Idempotent: succeeds if the object is already gone.
  delete(key: string): Promise<void>
}

// Keys are generated server-side as `<uuid>.<ext>`; anything else is rejected.
export const SAFE_KEY = /^[a-f0-9-]{36}\.[a-z0-9]{2,5}$/

const BASE_URL = (process.env.PUBLIC_UPLOAD_BASE_URL ?? 'http://localhost:3001/uploads').replace(/\/$/, '')

export function uploadUrl(key: string) {
  return `${BASE_URL}/${key}`
}

// A URL this server minted for an upload, or null for anything else (external
// avatars, junk). Used to delete the previous file when a profile replaces it.
export function ownedUploadKey(url: string | null | undefined): string | null {
  if (!url) return null
  const prefix = uploadUrl('')
  if (!url.startsWith(prefix)) return null
  const key = url.slice(prefix.length)
  return SAFE_KEY.test(key) ? key : null
}

let _provider: StorageProvider | null = null

// Factory — reads STORAGE_PROVIDER (local | s3), defaults to local.
export function storage(): StorageProvider {
  if (_provider) return _provider
  const provider = process.env.STORAGE_PROVIDER ?? 'local'
  switch (provider) {
    case 'local':
      return (_provider = new LocalStorageProvider())
    case 's3':
      return (_provider = new S3StorageProvider())
    default:
      throw new Error(`Unknown STORAGE_PROVIDER "${provider}"`)
  }
}
