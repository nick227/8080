import { AuthService } from '../services/AuthService'
import { cookieOptions, resolveSessionUser, SESSION_COOKIE, tokenFrom } from '../lib/session'
import { toUser } from '../lib/serialize'

const authService = new AuthService()

export async function createGuestSession(request: any, reply: any) {
  const existing = await resolveSessionUser(request)
  if (existing && !existing.suspendedAt) return reply.send({ data: toUser(existing) })

  const { user, token } = await authService.createGuest(request.body ?? {})
  reply.setCookie(SESSION_COOKIE, token, cookieOptions)
  return reply.status(201).send({ data: toUser(user) })
}

export async function register(request: any, reply: any) {
  const current = await resolveSessionUser(request)
  const { user, token } = await authService.register(current, request.body)
  if (token) reply.setCookie(SESSION_COOKIE, token, cookieOptions)
  return reply.status(201).send({ data: toUser(user) })
}

export async function login(request: any, reply: any) {
  const { user, token } = await authService.login(request.body)
  reply.setCookie(SESSION_COOKIE, token, cookieOptions)
  return reply.send({ data: toUser(user) })
}

export async function logout(request: any, reply: any) {
  const token = tokenFrom(request)
  if (token) await authService.logout(token)
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
  return reply.send({ data: null })
}

export async function getCurrentUser(request: any, reply: any) {
  return reply.send({ data: toUser(request.user) })
}

import { getGoogleLoginAuthUrl, exchangeAndVerifyGoogleLoginCode } from '../services/googleAuth'

export async function getGoogleLoginUrl(request: any, reply: any) {
  const url = getGoogleLoginAuthUrl(request.query?.state)
  return reply.send({ data: { url } })
}

export async function handleGoogleLoginCallback(request: any, reply: any) {
  const frontendUrl = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0] || 'http://localhost:5173'
  const { code, error } = request.query ?? {}

  if (error || !code) {
    return reply.redirect(`${frontendUrl}?authError=${encodeURIComponent(error || 'canceled')}`)
  }

  try {
    const current = await resolveSessionUser(request)
    const verified = await exchangeAndVerifyGoogleLoginCode(code)
    const { token } = await authService.loginWithGoogle({
      googleSub: verified.googleSub,
      email: verified.email,
      emailVerified: verified.emailVerified,
      displayName: verified.displayName,
      avatarUrl: verified.avatarUrl,
      currentSessionUser: current,
    })

    reply.setCookie(SESSION_COOKIE, token, cookieOptions)
    return reply.redirect(frontendUrl)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Google authentication failed'
    return reply.redirect(`${frontendUrl}?authError=${encodeURIComponent(msg)}`)
  }
}

