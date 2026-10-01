import { resolveSessionUser } from '../lib/session'

// Cookie-first (web); Bearer header fallback (native apps).
export async function bearerAuth(request: any, _reply: any, _params: any) {
  const user = await resolveSessionUser(request)
  if (!user) throw { statusCode: 401, message: 'Unauthorized' }
  if (user.suspendedAt) throw { statusCode: 403, message: 'Account suspended' }
  request.user = user
}
