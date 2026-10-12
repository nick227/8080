import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { SESSION_COOKIE } from '../../lib/session'
import { forbidden } from '../../lib/errors'

const localSecret = randomBytes(32).toString('hex')
export function adminCsrfToken(request: any) {
  const session = request.cookies?.[SESSION_COOKIE]
  if (!session) return null // Non-cookie API clients use explicit bearer authentication.
  const secret = process.env.SESSION_SECRET || (process.env.NODE_ENV !== 'production' ? localSecret : null)
  if (!secret) throw forbidden('Admin session protection is not configured')
  return createHmac('sha256', secret).update(`admin-csrf:${session}`).digest('hex')
}
export function verifyAdminCsrf(request: any) {
  const expected = adminCsrfToken(request)
  if (!expected) return
  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map(s => s.trim())
  const supplied = request.headers['x-admin-csrf']
  if (!origins.includes(request.headers.origin) || typeof supplied !== 'string' || !(/^[a-f0-9]{64}$/).test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    throw forbidden('Reload this page before confirming the change')
  }
}
