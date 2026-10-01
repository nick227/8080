// Generated from openapi.yaml — fill in seeds and assertions.
// Run `pnpm test:generate` to add stubs for new routes.
import { describe, it, expect } from 'vitest'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, seedRoom, seedItem } from './helpers'

const app = buildTestApp()

async function seed() {
  const room = await seedRoom(app, testUserId)
  const item = await seedItem(app, testUserId, room.id)
  return { room, item }
}

describe('addReaction', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'PUT', url: '/items/00000000-0000-0000-0000-000000000000/reactions/like' })
    expect(res.statusCode).toBe(401)
  })

  it('PUT /items/{itemId}/reactions/{type} is idempotent per user', async () => {
    const { item } = await seed()
    const url = `/items/${item.id}/reactions/like`
    await app.inject({ method: 'PUT', url, headers: asAuth(testUserId) })
    const res = await app.inject({ method: 'PUT', url, headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('addReaction', 200, res.json())
    expect(res.json().data.reactions).toEqual([{ type: 'like', count: 1, reacted: true }])

    const other = await app.inject({ method: 'PUT', url: `/items/${item.id}/reactions/ack`, headers: asAuth(testOtherUserId) })
    expect(other.json().data.reactions).toEqual([
      { type: 'like', count: 1, reacted: false },
      { type: 'ack', count: 1, reacted: true },
    ])
  })

  it('rejects unknown reaction types', async () => {
    const { item } = await seed()
    const res = await app.inject({ method: 'PUT', url: `/items/${item.id}/reactions/love`, headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(400)
  })

  it('404 on deleted items', async () => {
    const { item } = await seed()
    await app.inject({ method: 'DELETE', url: `/items/${item.id}`, headers: asAuth(testUserId) })
    const res = await app.inject({ method: 'PUT', url: `/items/${item.id}/reactions/like`, headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(404)
  })
})

describe('removeReaction', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/items/00000000-0000-0000-0000-000000000000/reactions/like' })
    expect(res.statusCode).toBe(401)
  })

  it('DELETE /items/{itemId}/reactions/{type} removes only the caller’s reaction', async () => {
    const { item } = await seed()
    const url = `/items/${item.id}/reactions/like`
    await app.inject({ method: 'PUT', url, headers: asAuth(testUserId) })
    await app.inject({ method: 'PUT', url, headers: asAuth(testOtherUserId) })

    const res = await app.inject({ method: 'DELETE', url, headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('removeReaction', 200, res.json())
    expect(res.json().data.reactions).toEqual([{ type: 'like', count: 1, reacted: false }])

    const again = await app.inject({ method: 'DELETE', url, headers: asAuth(testUserId) })
    expect(again.statusCode).toBe(200) // idempotent
  })
})
