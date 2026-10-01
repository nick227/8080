import { LocalStorageProvider } from './LocalStorageProvider'

// Storage provider interface — all providers implement this shape.
// Adapted from the file-upload plugin: providers return a key only; public URLs
// are derived per request via urlFor() so cloud providers can re-base or sign.

export interface StorageProvider {
  put(options: { key: string; buffer: Buffer; mimeType: string }): Promise<void>
  delete(key: string): Promise<void>
  urlFor(key: string): string
}

let _provider: StorageProvider | null = null

// Factory — reads STORAGE_PROVIDER env var, defaults to local.
// ## Phase 2 (deploy): add S3StorageProvider for the Railway bucket (S3-compatible).
export function storage(): StorageProvider {
  if (_provider) return _provider
  const provider = process.env.STORAGE_PROVIDER ?? 'local'
  switch (provider) {
    case 'local':
      _provider = new LocalStorageProvider()
      return _provider
    default:
      throw new Error(`Unknown STORAGE_PROVIDER "${provider}"`)
  }
}
