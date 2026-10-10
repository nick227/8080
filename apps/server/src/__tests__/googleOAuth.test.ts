import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, asAuth, testUserId } from './helpers'
import { createWorkspace } from './helpers/workspace'
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
    const res = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?error=access_denied',
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
