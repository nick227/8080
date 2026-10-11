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

import { randomBytes } from 'node:crypto'
import { getGoogleLoginAuthUrl, exchangeAndVerifyGoogleLoginCode } from '../services/googleAuth'
import { decryptSecret, encryptSecret } from '../lib/secrets'

// Google sign-in is bound to the browser that started it: the URL request sets a
// short-lived nonce cookie, the sealed `state` carries the same nonce, and the callback
// accepts only a matching pair. Without this, someone could send a signed-in person a
// callback link holding the sender's own Google code and link that Google identity to
// the victim's account.
const OAUTH_NONCE_COOKIE = 'google_oauth'
const OAUTH_TTL_MS = 10 * 60_000
type LoginState = { purpose: 'google-login'; nonce: string; exp: number }

export async function getGoogleLoginUrl(_request: any, reply: any) {
  const nonce = randomBytes(18).toString('base64url')
  const state: LoginState = { purpose: 'google-login', nonce, exp: Date.now() + OAUTH_TTL_MS }
  const url = getGoogleLoginAuthUrl(encryptSecret(state))
  reply.setCookie(OAUTH_NONCE_COOKIE, nonce, { ...cookieOptions, maxAge: OAUTH_TTL_MS / 1000 })
  return reply.send({ data: { url } })
}

function loginStateMatches(raw: unknown, nonce: unknown) {
  if (typeof raw !== 'string' || typeof nonce !== 'string' || !nonce) return false
  try {
    const state = decryptSecret<LoginState>(raw)
    return state?.purpose === 'google-login' && state.nonce === nonce && typeof state.exp === 'number' && state.exp > Date.now()
  } catch {
    return false
  }
}

export async function handleGoogleLoginCallback(request: any, reply: any) {
  const frontendUrl = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0] || 'http://localhost:5173'
  const { code, error, state } = request.query ?? {}
  const nonce = request.cookies?.[OAUTH_NONCE_COOKIE]
  reply.clearCookie(OAUTH_NONCE_COOKIE, { path: '/' })

  if (!loginStateMatches(state, nonce)) {
    return reply.redirect(`${frontendUrl}?authError=invalid_state`)
  }
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

