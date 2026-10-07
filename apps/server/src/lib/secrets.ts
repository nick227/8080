// Encryption for stored credentials (docs/agents/07 decision 4): AES-256-GCM with a
// keyring from SECRET_KEYS="<id>:<base64 32 bytes>,<id>:…". The first key encrypts;
// any listed key decrypts, so a key rotates by putting the new one first and
// re-saving. Outside production a fixed dev key stands in when none is set.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

type Key = { id: string; key: Buffer }

function keyring(): Key[] {
  const raw = process.env.SECRET_KEYS?.trim()
  if (!raw) {
    if (process.env.NODE_ENV === 'production') throw new Error('SECRET_KEYS is not set')
    return [{ id: 'dev', key: createHash('sha256').update('voice-chat dev secret key').digest() }]
  }
  return raw.split(',').map((entry) => {
    const [id, b64] = entry.trim().split(':')
    const key = Buffer.from(b64 ?? '', 'base64')
    if (!id || key.length !== 32) throw new Error('SECRET_KEYS entries must be <id>:<base64 of 32 bytes>')
    return { id, key }
  })
}

/** "v1.<keyId>.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptSecret(plain: unknown): string {
  const { id, key } = keyring()[0]!
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()])
  return ['v1', id, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

export function decryptSecret<T = unknown>(sealed: string): T {
  const [version, id, iv, tag, data] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unknown secret format')
  const entry = keyring().find((k) => k.id === id)
  if (!entry) throw new Error(`Secret key ${id} is not configured`)
  const decipher = createDecipheriv('aes-256-gcm', entry.key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
  return JSON.parse(plain) as T
}
