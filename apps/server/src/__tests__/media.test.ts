// Generated from openapi.yaml — fill in seeds and assertions.
// Run `pnpm test:generate` to add stubs for new routes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@project/db'
import { parseYouTubeVideoId } from '@project/shared'
import { setYouTubeLookup } from '../services/YouTubeService'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, seedRoom, seedItem, multipart } from './helpers'

const app = buildTestApp()

// File part first, fields after — the order the web client sends.
function upload(userId: string, opts: { type?: string; filename?: string; body?: Buffer; fields?: Record<string, string> } = {}) {
  const form = multipart([
    { name: 'file', value: opts.body ?? Buffer.from('fake-audio-bytes'), filename: opts.filename ?? 'rec', type: opts.type ?? 'audio/webm;codecs=opus' },
    ...Object.entries(opts.fields ?? { type: 'audio', duration: '4.5' }).map(([name, value]) => ({ name, value })),
  ])
  return app.inject({ method: 'POST', url: '/media', headers: { ...asAuth(userId), ...form.headers }, payload: form.payload })
}

describe('uploadMedia', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/media' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /media stores a recording and reads fields sent after the file', async () => {
    const res = await upload(testUserId)
    expect(res.statusCode).toBe(201)
    await validateResponse('uploadMedia', 201, res.json())
    const media = res.json().data
    expect(media).toMatchObject({ type: 'audio', mimeType: 'audio/webm', duration: 4.5, size: 16 })
    expect(media.url).toMatch(/^http:\/\/localhost:3001\/uploads\/[a-f0-9-]{36}\.webm$/)

    const served = await app.inject({ method: 'GET', url: new URL(media.url).pathname })
    expect(served.statusCode).toBe(200)
    expect(served.headers['x-content-type-options']).toBe('nosniff')
  })

  it('ignores the client filename extension', async () => {
    const res = await upload(testUserId, { type: 'image/png', filename: 'evil.html', fields: {} })
    expect(res.json().data.url).toMatch(/\.png$/)
  })

  it('rejects disallowed types (e.g. SVG) with 415', async () => {
    const res = await upload(testUserId, { type: 'image/svg+xml', filename: 'x.svg' })
    expect(res.statusCode).toBe(415)
  })

  it('rejects a bad duration', async () => {
    const res = await upload(testUserId, { fields: { duration: 'abc' } })
    expect(res.statusCode).toBe(400)
  })

  it('attaches to an item once, only by its owner', async () => {
    const room = await seedRoom(app, testUserId)
    const mine = (await upload(testUserId)).json().data
    const theirs = (await upload(testOtherUserId)).json().data

    const stolen = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/items`,
      headers: asAuth(testUserId),
      payload: { mediaIds: [theirs.id] },
    })
    expect(stolen.statusCode).toBe(400)
    expect(stolen.json().code).toBe('INVALID_MEDIA')

    const item = await seedItem(app, testUserId, room.id, { mediaIds: [mine.id] })
    const got = await app.inject({ method: 'GET', url: `/items/${item.id}`, headers: asAuth(testUserId) })
    expect(got.json().data.message.media).toEqual([mine])

    const reused = await app.inject({
      method: 'POST',
      url: `/rooms/${room.id}/items`,
      headers: asAuth(testUserId),
      payload: { mediaIds: [mine.id] },
    })
    expect(reused.statusCode).toBe(400)

    // A failed attach must not burn an item number.
    const next = await seedItem(app, testUserId, room.id)
    expect(next.number).toBe(2)
  })
})

describe('createYouTubeMedia', () => {
  // Deterministic lookup — tests never hit YouTube. Ids: 'dQw4w9WgXcQ' ok, 'noEmbed0000' embedding
  // disabled, 'missing0000' unavailable.
  beforeAll(() => setYouTubeLookup(async (id) =>
    id === 'missing0000' ? { status: 'unavailable' }
      : id === 'noEmbed0000' ? { status: 'not-embeddable', title: null }
        : { status: 'ok', title: 'Test video' }))
  afterAll(() => setYouTubeLookup(null))

  const yt = (userId: string, payload: object) =>
    app.inject({ method: 'POST', url: '/media/youtube', headers: asAuth(userId), payload })

  it('requires auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/media/youtube' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /media/youtube stores a canonical id + metadata, never a file', async () => {
    const res = await yt(testUserId, { url: 'https://youtu.be/dQw4w9WgXcQ?t=42&si=abc', durationMs: 212000 })
    expect(res.statusCode).toBe(201)
    await validateResponse('createYouTubeMedia', 201, res.json())
    expect(res.json().data).toMatchObject({
      type: 'video', source: 'youtube', externalId: 'dQw4w9WgXcQ', title: 'Test video', embeddable: true, duration: 212,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', poster: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', size: 0,
    })
    const row = await db.media.findUnique({ where: { id: res.json().data.id } })
    expect(row).toMatchObject({ storageKey: null, source: 'youtube' })
  })

  it('every common link format resolves to the same canonical id', async () => {
    for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube.com/live/dQw4w9WgXcQ']) {
      expect((await yt(testUserId, { url, durationMs: 1000 })).json().data.externalId).toBe('dQw4w9WgXcQ')
    }
  })

  it('INVALID_YOUTUBE_URL for playlists, other hosts and junk', async () => {
    for (const url of ['https://www.youtube.com/playlist?list=PL123', 'https://vimeo.com/1234', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'hello']) {
      const res = await yt(testUserId, { url })
      expect(res.statusCode).toBe(400)
      expect(res.json().code).toBe('INVALID_YOUTUBE_URL')
    }
  })

  it('YOUTUBE_UNAVAILABLE for missing/private videos (nothing stored)', async () => {
    const before = await db.media.count()
    const res = await yt(testUserId, { url: 'https://www.youtube.com/watch?v=missing0000', durationMs: 1000 })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('YOUTUBE_UNAVAILABLE')
    expect(await db.media.count()).toBe(before)
  })

  it('not embeddable (owner setting or client player) → link card: embeddable false, no duration', async () => {
    const byOwner = (await yt(testUserId, { url: 'https://youtu.be/noEmbed0000', durationMs: 5000 })).json().data
    const byClient = (await yt(testUserId, { url: 'https://youtu.be/dQw4w9WgXcQ', durationMs: 5000, embeddable: false })).json().data
    for (const m of [byOwner, byClient]) expect(m).toMatchObject({ embeddable: false, duration: null })
  })

  it('anchored replies work on a YouTube parent with a duration, and are refused without inline playback', async () => {
    const room = await seedRoom(app, testUserId)
    const playable = (await yt(testUserId, { url: 'https://youtu.be/dQw4w9WgXcQ', durationMs: 60000 })).json().data
    const parent = await seedItem(app, testUserId, room.id, { mediaIds: [playable.id] })
    const ok = await app.inject({ method: 'POST', url: `/items/${parent.id}/replies`, headers: asAuth(testOtherUserId), payload: { text: 'at 0:42', anchorStartMs: 42000 } })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().data.anchorStartMs).toBe(42000)
    const past = await app.inject({ method: 'POST', url: `/items/${parent.id}/replies`, headers: asAuth(testOtherUserId), payload: { text: 'x', anchorStartMs: 60001 } })
    expect(past.json().code).toBe('INVALID_ANCHOR')

    const card = (await yt(testUserId, { url: 'https://youtu.be/noEmbed0000' })).json().data
    const cardParent = await seedItem(app, testUserId, room.id, { mediaIds: [card.id] })
    const refused = await app.inject({ method: 'POST', url: `/items/${cardParent.id}/replies`, headers: asAuth(testOtherUserId), payload: { text: 'x', anchorStartMs: 0 } })
    expect(refused.json().code).toBe('ANCHOR_UNSUPPORTED')
  })

  it('sharing a YouTube post reuses the same media (no copy) and carries no anchors', async () => {
    const [a, b] = [await seedRoom(app, testUserId), await seedRoom(app, testUserId)]
    const m = (await yt(testUserId, { url: 'https://youtu.be/dQw4w9WgXcQ', durationMs: 60000 })).json().data
    const parent = await seedItem(app, testUserId, a.id, { mediaIds: [m.id] })
    await app.inject({ method: 'POST', url: `/items/${parent.id}/replies`, headers: asAuth(testUserId), payload: { text: 'here', anchorStartMs: 1000 } })
    const before = await db.media.count()
    const shared = await app.inject({ method: 'POST', url: `/messages/${parent.messageId}/share`, headers: asAuth(testUserId), payload: { roomIds: [b.id] } })
    expect(shared.json().data[0].message.media[0]).toMatchObject({ id: m.id, externalId: 'dQw4w9WgXcQ' })
    expect(await db.media.count()).toBe(before)
    const inB = await app.inject({ method: 'GET', url: `/rooms/${b.id}/items`, headers: asAuth(testUserId) })
    expect(inB.json().data).toHaveLength(1)
  })
})

describe('parseYouTubeVideoId (shared parser)', () => {
  it('canonicalizes common formats and rejects everything else', () => {
    const id = 'dQw4w9WgXcQ'
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'https://youtu.be/dQw4w9WgXcQ?t=10', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD1'])
      expect(parseYouTubeVideoId(u)).toBe(id)
    for (const u of ['https://www.youtube.com/playlist?list=PL1', 'https://www.youtube.com/watch?v=short', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'nope'])
      expect(parseYouTubeVideoId(u)).toBeNull()
  })
})
