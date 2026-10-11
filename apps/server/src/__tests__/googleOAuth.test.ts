import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, asAuth, testUserId } from './helpers'
import { createWorkspace, join, seedPeople, carolId, daveId } from './helpers/workspace'
import { AuthService } from '../services/AuthService'
import { EmailConnectionService } from '../services/agents/connections'
import { GoogleGmailProvider } from '../services/agents/email/googleGmail'
import { decryptSecret, encryptSecret } from '../lib/secrets'

const app = buildTestApp()
const authService = new AuthService()
const connectionService = new EmailConnectionService()

describe('Google Login OAuth', () => {
  it('GET /auth/google/url returns valid Google OAuth redirect URL', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/google/url' })
    expect(res.statusCode).toBe(200)
    const url = res.json().data.url
    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url).toContain('response_type=code')
    expect(url).toContain('openid')
  })

  it('creates new user account via loginWithGoogle', async () => {
    const googleSub = `google-sub-${Date.now()}`
    const email = `test.google.${Date.now()}@example.com`

    const { user, token } = await authService.loginWithGoogle({
      googleSub,
      email,
      emailVerified: true,
      displayName: 'Google User',
      avatarUrl: 'https://example.com/avatar.jpg',
    })

    expect(user).toBeTruthy()
    expect(user.email).toBe(email)
    expect(user.googleSub).toBe(googleSub)
    expect(user.isGuest).toBe(false)
    expect(user.profile?.displayName).toBe('Google User')
    expect(token).toBeTruthy()
  })

  it('authenticates existing user by stable googleSub', async () => {
    const googleSub = `google-sub-existing-${Date.now()}`
    const email = `existing.google.${Date.now()}@example.com`

    const first = await authService.loginWithGoogle({
      googleSub,
      email,
      emailVerified: true,
      displayName: 'First Signin',
    })

    const second = await authService.loginWithGoogle({
      googleSub,
      email: 'different.email@example.com',
      emailVerified: true,
      displayName: 'Second Signin',
    })

    expect(second.user.id).toBe(first.user.id)
    expect(second.user.googleSub).toBe(googleSub)
  })

  it('links googleSub to existing authenticated session user', async () => {
    const guestUser = await authService.createGuest({ displayName: 'Guest Link Test' })
    const googleSub = `google-sub-link-${Date.now()}`
    const email = `linked.${Date.now()}@example.com`

    const linked = await authService.loginWithGoogle({
      googleSub,
      email,
      emailVerified: true,
      displayName: 'Linked User',
      currentSessionUser: guestUser.user as any,
    })

    expect(linked.user.id).toBe(guestUser.user.id)
    expect(linked.user.googleSub).toBe(googleSub)
    expect(linked.user.isGuest).toBe(false)
    expect(linked.user.email).toBe(email)
  })

  it('handles callback error parameter gracefully by redirecting to frontend with authError', async () => {
    const started = await app.inject({ method: 'GET', url: '/auth/google/url' })
    const state = new URL(started.json().data.url).searchParams.get('state')!
    const nonce = started.cookies.find((c) => c.name === 'google_oauth')!.value
    const res = await app.inject({
      method: 'GET',
      url: `/auth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      cookies: { google_oauth: nonce },
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('authError=access_denied')
  })
})

describe('Gmail OAuth Connect & Email Provider', () => {
  let workspaceId: string

  beforeEach(async () => {
    const ws = await createWorkspace(app, testUserId, { name: `Test WS ${Date.now()}` })
    workspaceId = ws.id
  })

  it('creates or updates a Google Gmail EmailConnection with encrypted credentials', async () => {
    const emailAddress = `test.gmail.${Date.now()}@gmail.com`
    const member = await db.workspaceMember.findFirstOrThrow({
      where: { workspaceId, status: 'active' },
    })

    const connection = await connectionService.createOrUpdateGoogleConnection({
      workspaceId,
      memberId: member.id,
      emailAddress,
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresIn: 3600,
      scope: 'https://www.googleapis.com/auth/gmail.send',
    })

    expect(connection.strategy).toBe('google')
    expect(connection.fromAddress).toBe(emailAddress)
    expect(connection.status).toBe('active')

    // Verify database row holds encrypted secret
    const dbRow = await db.emailConnection.findUniqueOrThrow({ where: { id: connection.id } })
    expect(dbRow.secret).not.toBeNull()
    expect(dbRow.secret).not.toContain('test-access-token')
    const decrypted = decryptSecret<{ accessToken: string; refreshToken: string }>(dbRow.secret!)
    expect(decrypted.accessToken).toBe('test-access-token')
    expect(decrypted.refreshToken).toBe('test-refresh-token')
  })

  it('preserves existing refresh_token when re-authorizing without a new refresh token', async () => {
    const emailAddress = `preserve.refresh.${Date.now()}@gmail.com`
    const member = await db.workspaceMember.findFirstOrThrow({
      where: { workspaceId, status: 'active' },
    })

    await connectionService.createOrUpdateGoogleConnection({
      workspaceId,
      memberId: member.id,
      emailAddress,
      accessToken: 'initial-access-token',
      refreshToken: 'original-refresh-token',
      expiresIn: 3600,
    })

    const updated = await connectionService.createOrUpdateGoogleConnection({
      workspaceId,
      memberId: member.id,
      emailAddress,
      accessToken: 'new-access-token',
      refreshToken: null, // Google didn't return a new refresh token
      expiresIn: 3600,
    })

    const dbRow = await db.emailConnection.findUniqueOrThrow({ where: { id: updated.id } })
    const decrypted = decryptSecret<{ accessToken: string; refreshToken: string }>(dbRow.secret!)
    expect(decrypted.accessToken).toBe('new-access-token')
    expect(decrypted.refreshToken).toBe('original-refresh-token')
  })

  it('isolates connections per workspace', async () => {
    const otherWs = await createWorkspace(app, testUserId, { name: `Other WS ${Date.now()}` })
    const list1 = await connectionService.list(testUserId, workspaceId)
    const list2 = await connectionService.list(testUserId, otherWs.id)

    const googleConnectionsInOther = list2.filter((c) => c.strategy === 'google')
    expect(googleConnectionsInOther).toHaveLength(0)
  })

  it('GoogleGmailProvider formats MIME and returns providerMessageId on successful mock send', async () => {
    const provider = new GoogleGmailProvider()
    const emailAddress = `sender.${Date.now()}@gmail.com`

    const connRow = await db.emailConnection.create({
      data: {
        workspaceId,
        strategy: 'google',
        displayName: 'Test Gmail Sender',
        fromAddress: emailAddress,
        secret: encryptSecret({
          accessToken: 'valid-mock-token',
          refreshToken: 'valid-refresh-token',
          expiresAt: Date.now() + 3600 * 1000,
          emailAddress,
        }),
        status: 'active',
      },
    })

    // Mock fetch for Gmail send API
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('gmail.googleapis.com/gmail/v1/users/me/messages/send')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'gmail-msg-id-12345' }),
        } as any
      }
      return originalFetch(url)
    })

    try {
      const result = await provider.send(connRow, {
        to: 'recipient@example.com',
        subject: 'Hello from Gmail',
        text: 'Plain body text',
        html: '<p>Plain body text</p>',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.providerMessageId).toBe('gmail-msg-id-12345')
      }
    } finally {
      global.fetch = originalFetch
    }
  })
})

// The OAuth `state` is the only thing tying a Google callback to who started it.
describe('Google OAuth state binding', () => {
  const stateOf = (url: string) => new URL(url).searchParams.get('state')!
  // These routes sit outside the spec, so they read real sessions (no test bearer shortcut).
  const session = async (userId: string) => {
    const token = `oauth-test-${userId}-${Math.random().toString(36).slice(2)}`
    await db.session.create({ data: { userId, token, expiresAt: new Date(Date.now() + 3_600_000) } })
    return { Authorization: `Bearer ${token}` }
  }

  it('sign-in: the callback needs the sealed state and the nonce cookie from the same browser', async () => {
    const exchange = vi.spyOn(globalThis, 'fetch')
    const started = await app.inject({ method: 'GET', url: '/auth/google/url' })
    const state = stateOf(started.json().data.url)
    const nonce = started.cookies.find((c) => c.name === 'google_oauth')
    expect(nonce?.httpOnly).toBe(true)

    // A link carrying someone else's code: no state, a forged state, or a state minted in another browser.
    const other = await app.inject({ method: 'GET', url: '/auth/google/url' })
    const attempts: { url: string; cookies: Record<string, string> }[] = [
      { url: '/auth/google/callback?code=attacker-code', cookies: { google_oauth: nonce!.value } },
      { url: `/auth/google/callback?code=attacker-code&state=${Buffer.from('{"purpose":"google-login","nonce":"x"}').toString('base64url')}`, cookies: { google_oauth: 'x' } },
      { url: `/auth/google/callback?code=attacker-code&state=${encodeURIComponent(stateOf(other.json().data.url))}`, cookies: { google_oauth: nonce!.value } },
      { url: `/auth/google/callback?code=attacker-code&state=${encodeURIComponent(state)}`, cookies: {} },
    ]
    for (const attempt of attempts) {
      const res = await app.inject({ method: 'GET', url: attempt.url, cookies: attempt.cookies, headers: await session(testUserId) })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toContain('authError=invalid_state')
    }
    expect(exchange).not.toHaveBeenCalled()
    exchange.mockRestore()
  })

  it('Gmail connect: the URL needs a signed-in admin of the workspace', async () => {
    await seedPeople()
    const ws = await createWorkspace(app, testUserId, { name: `Gmail ${Date.now()}` })
    await join(app, ws.id, carolId, 'carol@test.local', 'member')
    const url = `/workspaces/${ws.id}/integrations/google/url`
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url, headers: await session(carolId) })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url, headers: await session(daveId) })).statusCode).toBe(404)
    const ok = await app.inject({ method: 'GET', url, headers: await session(testUserId) })
    expect(ok.statusCode).toBe(200)
    expect(stateOf(ok.json().data.url)).not.toContain(ws.id) // sealed, not readable JSON
  })

  it('Gmail connect: a forged or edited state, or another session, attaches nothing', async () => {
    await seedPeople()
    const ws = await createWorkspace(app, testUserId, { name: `Gmail ${Date.now()}` })
    await join(app, ws.id, daveId, 'dave@test.local', 'admin')
    const exchange = vi.spyOn(globalThis, 'fetch')
    const forged = Buffer.from(JSON.stringify({ workspaceId: ws.id, userId: testUserId, nonce: 1 })).toString('base64url')
    const minted = stateOf((await app.inject({ method: 'GET', url: `/workspaces/${ws.id}/integrations/google/url`, headers: await session(testUserId) })).json().data.url)
    const parts = minted.split('.')
    const body = Buffer.from(parts[4]!, 'base64url'); body[0] = body[0]! ^ 1; parts[4] = body.toString('base64url')

    const cases: [string, Record<string, string>, string][] = [
      [forged, await session(testUserId), 'gmailError=invalid_state'],
      [parts.join('.'), await session(testUserId), 'gmailError=invalid_state'],
      [minted, {}, 'gmailError=unauthorized'], // signed out
      [minted, await session(daveId), 'gmailError=unauthorized'], // another admin's browser
    ]
    for (const [state, headers, outcome] of cases) {
      const res = await app.inject({ method: 'GET', url: `/integrations/google/callback?code=attacker-code&state=${encodeURIComponent(state)}`, headers })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toContain(outcome)
    }
    expect(exchange).not.toHaveBeenCalled()
    exchange.mockRestore()
    expect(await db.emailConnection.count({ where: { workspaceId: ws.id, strategy: 'google' } })).toBe(0)
  })

  it('Gmail connect: an expired state is refused; a demoted admin attaches nothing', async () => {
    await seedPeople()
    const ws = await createWorkspace(app, testUserId, { name: `Gmail ${Date.now()}` })
    const daveMember = await join(app, ws.id, daveId, 'dave@test.local', 'admin')
    const exchange = vi.spyOn(globalThis, 'fetch')
    const expired = encryptSecret({ purpose: 'gmail-connect', workspaceId: ws.id, userId: testUserId, exp: Date.now() - 1 })
    const res = await app.inject({ method: 'GET', url: `/integrations/google/callback?code=c&state=${encodeURIComponent(expired)}`, headers: await session(testUserId) })
    expect(res.headers.location).toContain('gmailError=invalid_state')

    const daveState = stateOf((await app.inject({ method: 'GET', url: `/workspaces/${ws.id}/integrations/google/url`, headers: await session(daveId) })).json().data.url)
    await db.workspaceMember.update({ where: { id: daveMember }, data: { role: 'member' } })
    const demoted = await app.inject({ method: 'GET', url: `/integrations/google/callback?code=c&state=${encodeURIComponent(daveState)}`, headers: await session(daveId) })
    expect(demoted.headers.location).toContain('gmailError=')
    expect(demoted.headers.location).toContain(`/c/${ws.id}`)
    expect(exchange).not.toHaveBeenCalled()
    exchange.mockRestore()
    expect(await db.emailConnection.count({ where: { workspaceId: ws.id, strategy: 'google' } })).toBe(0)
  })

  it('Gmail connect: the admin who started it gets the sender, and lands back on the company', async () => {
    const ws = await createWorkspace(app, testUserId, { name: `Gmail ${Date.now()}` })
    const state = stateOf((await app.inject({ method: 'GET', url: `/workspaces/${ws.id}/integrations/google/url`, headers: await session(testUserId) })).json().data.url)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }))
      if (url.includes('gmail/v1/users/me/profile')) return new Response(JSON.stringify({ emailAddress: 'owner@gmail.com' }))
      return new Response('{}', { status: 404 })
    })
    const res = await app.inject({ method: 'GET', url: `/integrations/google/callback?code=good&state=${encodeURIComponent(state)}`, headers: await session(testUserId) })
    fetchMock.mockRestore()
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain(`/c/${ws.id}?settings=integrations&gmailSuccess=1`)
    const rows = await db.emailConnection.findMany({ where: { workspaceId: ws.id, strategy: 'google' } })
    expect(rows.map((r) => r.fromAddress)).toEqual(['owner@gmail.com'])
  })
})
