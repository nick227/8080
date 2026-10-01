// Generated from openapi.yaml — fill in seeds and assertions.
// Run `pnpm test:generate` to add stubs for new routes.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import bcrypt from 'bcryptjs'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId } from './helpers'

const app = buildTestApp()

const tokenOf = (res: any) => res.cookies.find((c: any) => c.name === 'token')?.value as string | undefined

async function guest(displayName?: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/guest', payload: displayName ? { displayName } : {} })
  return { res, token: tokenOf(res)!, user: res.json().data }
}

describe('createGuestSession', () => {
  it('creates a guest user and sets an httpOnly session cookie', async () => {
    const { res, token, user } = await guest()
    expect(res.statusCode).toBe(201)
    await validateResponse('createGuestSession', 201, res.json())
    expect(user.isGuest).toBe(true)
    expect(user.email).toBeNull()
    expect(user.displayName).toMatch(/^Guest [A-Z0-9]{4}$/)
    expect(token).toBeTruthy()
    expect(res.cookies[0]?.httpOnly).toBe(true)
  })

  it('uses the provided displayName', async () => {
    const { user } = await guest('Nick')
    expect(user.displayName).toBe('Nick')
  })

  it('reuses an existing valid session instead of creating another user', async () => {
    const first = await guest()
    const res = await app.inject({ method: 'POST', url: '/auth/guest', cookies: { token: first.token } })
    expect(res.statusCode).toBe(200)
    await validateResponse('createGuestSession', 200, res.json())
    expect(res.json().data.id).toBe(first.user.id)
  })
})

describe('register', () => {
  it('upgrades the current guest in place, keeping id and session', async () => {
    const g = await guest()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      cookies: { token: g.token },
      payload: { email: 'New@Example.com', password: 'password123', displayName: 'Newbie' },
    })
    expect(res.statusCode).toBe(201)
    await validateResponse('register', 201, res.json())
    const user = res.json().data
    expect(user.id).toBe(g.user.id)
    expect(user.isGuest).toBe(false)
    expect(user.email).toBe('new@example.com')
    expect(user.displayName).toBe('Newbie')
    expect(tokenOf(res)).toBeUndefined() // existing session kept

    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies: { token: g.token } })
    expect(me.json().data.isGuest).toBe(false)
  })

  it('creates a new account with a session when there is no session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'fresh@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(201)
    expect(tokenOf(res)).toBeTruthy()
    expect(res.json().data.displayName).toBe('fresh')
  })

  it('rejects a taken email with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'alice@test.local', password: 'password123' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('EMAIL_TAKEN')
  })

  it('rejects short passwords', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'short@example.com', password: 'short' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('never exposes passwordHash', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'hash@example.com', password: 'password123' },
    })
    expect(res.body).not.toContain('passwordHash')
    expect(res.body).not.toContain('$2')
  })
})

describe('login', () => {
  it('logs in with correct credentials and sets a cookie', async () => {
    await db.user.update({ where: { id: testUserId }, data: { passwordHash: await bcrypt.hash('password123', 4) } })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ALICE@test.local', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    await validateResponse('login', 200, res.json())
    expect(res.json().data.id).toBe(testUserId)
    expect(tokenOf(res)).toBeTruthy()
  })

  it('rejects a wrong password with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'alice@test.local', password: 'wrong-password' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects unknown emails with the same 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@test.local', password: 'password123' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('logout', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /auth/logout ends the session', async () => {
    const g = await guest()
    const res = await app.inject({ method: 'POST', url: '/auth/logout', cookies: { token: g.token } })
    expect(res.statusCode).toBe(200)
    await validateResponse('logout', 200, res.json())
    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies: { token: g.token } })
    expect(me.statusCode).toBe(401)
  })
})

describe('getCurrentUser', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /auth/me', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: asAuth(testOtherUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('getCurrentUser', 200, res.json())
    expect(res.json().data).toMatchObject({ id: testOtherUserId, isGuest: true, displayName: 'Guest BOB' })
  })

  it('accepts a real session cookie', async () => {
    const g = await guest()
    const res = await app.inject({ method: 'GET', url: '/auth/me', cookies: { token: g.token } })
    expect(res.json().data.id).toBe(g.user.id)
  })
})
