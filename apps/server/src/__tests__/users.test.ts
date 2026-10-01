// Generated from openapi.yaml — fill in seeds and assertions.
// Run `pnpm test:generate` to add stubs for new routes.
import { describe, it, expect } from 'vitest'
import { buildTestApp, asAuth, validateResponse, testUserId } from './helpers'

const app = buildTestApp()

describe('updateCurrentUser', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/users/me' })
    expect(res.statusCode).toBe(401)
  })

  it('PATCH /users/me', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: asAuth(testUserId),
      payload: { displayName: '  Renamed  ', avatarUrl: 'https://example.com/a.png' },
    })
    expect(res.statusCode).toBe(200)
    await validateResponse('updateCurrentUser', 200, res.json())
    expect(res.json().data).toMatchObject({ displayName: 'Renamed', avatarUrl: 'https://example.com/a.png' })
  })

  it('rejects an empty displayName', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: asAuth(testUserId),
      payload: { displayName: '' },
    })
    expect(res.statusCode).toBe(400)
  })
})
