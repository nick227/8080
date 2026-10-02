// Generated from openapi.yaml — fill in seeds and assertions.
// Run `pnpm test:generate` to add stubs for new routes.
import { describe, it, expect } from 'vitest'
import { access } from 'fs/promises'
import { join } from 'path'
import { db } from '@project/db'
import { UPLOADS_DIR } from '../providers/LocalStorageProvider'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, multipart } from './helpers'

const app = buildTestApp()

function avatarForm(opts: { type?: string; body?: Buffer } = {}) {
  return multipart([{ name: 'file', value: opts.body ?? Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('png-bytes')]), filename: 'face', type: opts.type ?? 'image/png' }])
}

function uploadAvatar(userId: string, opts?: { type?: string; body?: Buffer }) {
  const form = avatarForm(opts)
  return app.inject({ method: 'POST', url: '/users/me/avatar', headers: { ...asAuth(userId), ...form.headers }, payload: form.payload })
}

async function keyOf(url: string, asUser: string) {
  const playback = await app.inject({ method: 'GET', url: new URL(url).pathname, headers: asAuth(asUser) });
  return new URL(playback.headers.location).pathname.split('/').pop()!;
}

async function fileExists(key: string) {
  return access(join(UPLOADS_DIR, key)).then(() => true, () => false)
}

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

  it('deletes the previous avatar file when the url changes', async () => {
    const uploaded = await uploadAvatar(testUserId)
    const url = uploaded.json().data.avatarUrl as string
    const key = await keyOf(url, testUserId)
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: asAuth(testUserId),
      payload: { avatarUrl: 'https://example.com/a.png' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.avatarUrl).toBe('https://example.com/a.png')
    expect(await fileExists(key)).toBe(false)
    expect(await db.media.findUnique({ where: { storageKey: key } })).toBeNull()
  })
})

describe('uploadAvatar', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/users/me/avatar' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects guests', async () => {
    const res = await uploadAvatar(testOtherUserId)
    expect(res.statusCode).toBe(403)
    expect(await db.media.count({ where: { ownerId: testOtherUserId } })).toBe(0)
  })

  it('stores an image and serves it', async () => {
    const res = await uploadAvatar(testUserId)
    expect(res.statusCode).toBe(200)
    await validateResponse('uploadAvatar', 200, res.json())
    const url = res.json().data.avatarUrl as string
    expect(url).toMatch(/^http:\/\/localhost:3001\/media\/[a-z0-9]+\/playback$/)
    const playback = await app.inject({ method: 'GET', url: new URL(url).pathname, headers: asAuth(testUserId) })
    const served = await app.inject({ method: 'GET', url: new URL(playback.headers.location).pathname })
    expect(served.statusCode).toBe(200)
    expect(served.rawPayload.subarray(8).toString()).toBe('png-bytes')
  })

  it('replaces the previous avatar and deletes its file', async () => {
    const first = await uploadAvatar(testUserId)
    const firstUrl = first.json().data.avatarUrl as string
    const firstKey = await keyOf(firstUrl, testUserId)

    const second = await uploadAvatar(testUserId, { type: 'image/jpeg', body: Buffer.concat([Buffer.from('ffd8ff', 'hex'), Buffer.from('jpeg-bytes')]) })
    expect(second.statusCode).toBe(200)
    const secondUrl = second.json().data.avatarUrl as string
    expect(secondUrl).not.toBe(firstUrl)
    const secondKey = await keyOf(secondUrl, testUserId)
    expect(secondKey).toMatch(/\.jpg$/)

    expect(await fileExists(firstKey)).toBe(false)
    expect(await db.media.findUnique({ where: { storageKey: firstKey } })).toBeNull()
    expect(await fileExists(await keyOf(secondUrl, testUserId))).toBe(true)
    expect(await db.media.count({ where: { ownerId: testUserId, name: 'avatar' } })).toBe(1)
  })

  it('rejects a non-image and keeps no file', async () => {
    const res = await uploadAvatar(testUserId, { type: 'audio/webm' })
    expect(res.statusCode).toBe(415)
    expect(await db.media.count({ where: { ownerId: testUserId } })).toBe(0)
  })

  it('keeps an upload that is already attached to a message', async () => {
    const form = multipart([{ name: 'file', value: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('posted')]), filename: 'shot', type: 'image/png' }])
    const media = await app.inject({ method: 'POST', url: '/media', headers: { ...asAuth(testUserId), ...form.headers }, payload: form.payload })
    const uploaded = media.json().data as { id: string; url: string }
    const message = await db.message.create({ data: { authorId: testUserId, text: 'posted' } })
    await db.media.update({ where: { id: uploaded.id }, data: { messageId: message.id } })
    await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: asAuth(testUserId),
      payload: { avatarUrl: uploaded.url },
    })
    const replaced = await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: asAuth(testUserId),
      payload: { avatarUrl: null },
    })
    expect(replaced.statusCode).toBe(200)
    expect(await db.media.findUnique({ where: { storageKey: await keyOf(uploaded.url, testUserId) } })).not.toBeNull()
    expect(await fileExists(await keyOf(uploaded.url, testUserId))).toBe(true)
  })
})
