// Signed playback tokens: /media/:id/playback?token=…
//
// Media elements routed through Web Audio need crossOrigin="anonymous", which sends
// no cookies, so a session alone can't authorize their requests. Media URLs handed to
// a viewer who may see the media carry a short-lived token for that one media id.
// The token holds only { m: mediaId, e: expiresAt (unix seconds) }, HMAC-SHA256
// signed with a server secret. It authorizes playback of that media id until it
// expires — nothing else.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

const TTL_S = 15 * 60
// URLs stay identical within a bucket (stable for caching); each is valid 10–15 min.
const BUCKET_S = 5 * 60

let key: Buffer | null = null
function signingKey(): Buffer {
  if (key) return key
  const secret = process.env.PLAYBACK_TOKEN_SECRET || process.env.SESSION_SECRET
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('PLAYBACK_TOKEN_SECRET or SESSION_SECRET must be set')
  // Domain-separated from the cookie signer; without a secret (dev/test), per process.
  key = createHash('sha256').update('playback-token:').update(secret || randomBytes(32)).digest()
  return key
}

const b64 = (buf: Buffer) => buf.toString('base64url')
const sign = (payload: string) => createHmac('sha256', signingKey()).update(payload).digest()

export function playbackToken(mediaId: string, now = Date.now()): string {
  const nowS = Math.floor(now / 1000)
  const e = Math.ceil(nowS / BUCKET_S) * BUCKET_S + (TTL_S - BUCKET_S)
  const payload = b64(Buffer.from(JSON.stringify({ m: mediaId, e })))
  return `${payload}.${b64(sign(payload))}`
}

/** True only for an untampered, unexpired token issued for exactly this media id. */
export function verifyPlaybackToken(token: unknown, mediaId: string, now = Date.now()): boolean {
  if (typeof token !== 'string' || token.length > 512) return false
  const [payload, mac, extra] = token.split('.')
  if (!payload || !mac || extra !== undefined) return false
  const expected = sign(payload)
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false
  try {
    const { m, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return m === mediaId && typeof e === 'number' && e * 1000 > now
  } catch {
    return false
  }
}
