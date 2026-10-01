import { db } from '@project/db'

export const SESSION_COOKIE = 'token'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // Production: web and API are on different domains — cross-site requests
  // require SameSite=None with Secure=true or the browser blocks the cookie.
  // Dev: both on localhost (same-site regardless of port), so Lax works.
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
  maxAge: SESSION_TTL_MS / 1000,
}

export const userInclude = { profile: true } as const

export function tokenFrom(request: any): string | undefined {
  return request.cookies?.[SESSION_COOKIE] ?? request.headers.authorization?.replace(/^Bearer /, '') ?? undefined
}

// Resolves the session's user, or null. Used by bearerAuth and by public
// routes (guest/register) that behave differently when a session exists.
export async function resolveSessionUser(request: any) {
  const token = tokenFrom(request)
  if (!token) return null
  const session = await db.session.findUnique({
    where: { token },
    include: { user: { include: userInclude } },
  })
  if (!session || session.expiresAt < new Date() || session.user.deletedAt) return null
  return session.user
}
