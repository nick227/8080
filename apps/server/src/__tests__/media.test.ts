// Generated from openapi.yaml — fill in seeds and assertions.
// Run `pnpm test:generate` to add stubs for new routes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@project/db'
import { parseYouTubeVideoId } from '@project/shared'
import { setYouTubeLookup } from '../services/YouTubeService'
import { readdirSync } from 'fs'
import { UPLOADS_DIR } from '../providers/LocalStorageProvider'
import { parseRange } from '../lib/range'
import { Readable } from 'stream'
import { MediaService, matchesSignature } from '../services/MediaService'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, seedRoom, seedItem, multipart, fileBytes, storedPath } from './helpers'

const app = buildTestApp()

// File part first, fields after — the order the web client sends.
function upload(userId: string, opts: { type?: string; filename?: string; body?: Buffer; fields?: Record<string, string> } = {}) {
  const form = multipart([
    { name: 'file', value: opts.body ?? fileBytes(opts.type ?? 'audio/webm', 'fake-audio-bytes'), filename: opts.filename ?? 'rec', type: opts.type ?? 'audio/webm;codecs=opus' },
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
    expect(media).toMatchObject({ type: 'audio', mimeType: 'audio/webm', duration: 4.5, size: 20 })
    expect(media.url).toBe(`http://localhost:3001/media/${media.id}/playback`)
    expect(await storedPath(media.id)).toMatch(/^\/uploads\/[a-f0-9-]{36}\.webm$/)

    const served = await app.inject({ method: 'GET', url: await storedPath(media.id) })
    expect(served.statusCode).toBe(200)
    expect(served.headers['x-content-type-options']).toBe('nosniff')
  })

  it('ignores the client filename extension', async () => {
    const res = await upload(testUserId, { type: 'image/png', filename: 'evil.html', fields: {} })
    expect(await storedPath(res.json().data.id)).toMatch(/\.png$/)
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

// Every failure path must leave no stored object and no Media row behind.
async function expectNothingStored(res: Promise<{ statusCode: number; json: () => any }>, status: number, code: string) {
  const files = readdirSync(UPLOADS_DIR).length
  const rows = await db.media.count()
  const r = await res
  expect(r.statusCode).toBe(status)
  expect(r.json().code).toBe(code)
  expect(readdirSync(UPLOADS_DIR).length).toBe(files)
  expect(await db.media.count()).toBe(rows)
}

describe('uploadMedia (streamed to storage)', () => {
  it('stores the exact bytes and records their size', async () => {
    const body = fileBytes('audio/webm', Buffer.from(Array.from({ length: 70_000 }, (_, i) => i % 251)))
    const media = (await upload(testUserId, { body })).json().data
    expect(media.size).toBe(body.length)
    const served = await app.inject({ method: 'GET', url: await storedPath(media.id) })
    expect(served.rawPayload.equals(body)).toBe(true)
  })

  it('over the size limit → 413 FILE_TOO_LARGE, nothing kept', async () => {
    const big = Buffer.alloc(1024 * 1024 + 1) // vitest sets UPLOAD_MAX_SIZE_MB=1
    await expectNothingStored(upload(testUserId, { body: big }), 413, 'FILE_TOO_LARGE')
  })

  it('disallowed type → 415 before anything is written', async () => {
    await expectNothingStored(upload(testUserId, { type: 'text/html', filename: 'x.html' }), 415, 'UNSUPPORTED_TYPE')
  })

  it('a bad field after the file removes the already-stored file', async () => {
    await expectNothingStored(upload(testUserId, { fields: { duration: '-1' } }), 400, 'INVALID_DURATION')
  })

  it('empty file → 400 EMPTY_FILE, nothing kept', async () => {
    await expectNothingStored(upload(testUserId, { body: Buffer.alloc(0) }), 400, 'EMPTY_FILE')
  })

  it('no file part → 400 MISSING_FILE', async () => {
    const form = multipart([{ name: 'name', value: 'x' }])
    const res = await app.inject({ method: 'POST', url: '/media', headers: { ...asAuth(testUserId), ...form.headers }, payload: form.payload })
    expect(res.json().code).toBe('MISSING_FILE')
  })
})

describe('upload signatures', () => {
  it('content that does not match the declared type → 415, nothing kept', async () => {
    const html = Buffer.from('<!doctype html><script>alert(1)</script>')
    for (const type of ['image/png', 'video/mp4', 'audio/mp4', 'image/webp', 'audio/wav', 'video/quicktime'])
      await expectNothingStored(upload(testUserId, { type, body: html, fields: {} }), 415, 'UNSUPPORTED_TYPE')
  })

  it('a file too short to identify → 415', async () => {
    await expectNothingStored(upload(testUserId, { body: Buffer.from([0x1a, 0x45]) }), 415, 'UNSUPPORTED_TYPE')
  })

  it('tiny first chunks cannot slip past the check', async () => {
    const service = new MediaService()
    const trickle = (bytes: Buffer) => Readable.from([...bytes].map((b) => Buffer.from([b])))
    const html = Buffer.from('<html><body>not a picture at all</body></html>')
    await expect(service.store({ file: trickle(html), mimetype: 'image/png' })).rejects.toMatchObject({ statusCode: 415 })
    const png = fileBytes('image/png', 'x'.repeat(40))
    const stored = await service.store({ file: trickle(png), mimetype: 'image/png' })
    expect(stored.size).toBe(png.length)
    await service.discard(stored)
  })

  it('every allowed type has a signature', () => {
    expect(matchesSignature(fileBytes('audio/webm'), 'audio/webm')).toBe(true)
    expect(matchesSignature(Buffer.from('....ftypisom'), 'video/mp4')).toBe(true)
    expect(matchesSignature(Buffer.from('RIFF....WEBPVP8 '), 'image/webp')).toBe(true)
    expect(matchesSignature(Buffer.from('RIFF....WAVEfmt '), 'image/webp')).toBe(false)
    expect(matchesSignature(fileBytes('image/png'), 'image/svg+xml')).toBe(false)
  })
})

describe('GET /uploads/:key', () => {
  const bytes = fileBytes('audio/webm', '456789abcdefghij') // 20 bytes: 4-byte signature + 4…j
  const get = async (headers: Record<string, string> = {}) => {
    const path = await storedPath((await upload(testUserId, { body: bytes })).json().data.id)
    return app.inject({ method: 'GET', url: path, headers })
  }

  it('serves the whole file with type, length, caching and safety headers', async () => {
    const res = await get({ origin: 'http://localhost:5173' })
    expect(res.statusCode).toBe(200)
    expect(res.rawPayload.equals(bytes)).toBe(true)
    expect(res.headers).toMatchObject({
      'content-type': 'audio/webm',
      'content-length': '20',
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'cross-origin',
      // Locked: crossOrigin="anonymous" audio in the Web Audio graph needs ACAO.
      'access-control-allow-origin': 'http://localhost:5173',
    })
  })

  it('serves byte ranges (206) — media elements need them to seek', async () => {
    const mid = await get({ range: 'bytes=5-9' })
    expect(mid.statusCode).toBe(206)
    expect(mid.payload).toBe('56789')
    expect(mid.headers).toMatchObject({ 'content-range': 'bytes 5-9/20', 'content-length': '5' })

    expect((await get({ range: 'bytes=15-' })).payload).toBe('fghij')
    expect((await get({ range: 'bytes=-3' })).payload).toBe('hij')
    expect((await get({ range: 'bytes=18-999' })).headers['content-range']).toBe('bytes 18-19/20')
  })

  it('416 for a range past the end; malformed ranges serve the whole file', async () => {
    const res = await get({ range: 'bytes=20-' })
    expect(res.statusCode).toBe(416)
    expect(res.headers['content-range']).toBe('bytes */20')
    expect((await get({ range: 'bytes=0-1,4-5' })).statusCode).toBe(200)
  })

  it('HEAD and If-None-Match send no body', async () => {
    const url = await storedPath((await upload(testUserId, { body: bytes })).json().data.id)
    const head = await app.inject({ method: 'HEAD', url })
    expect(head.statusCode).toBe(200)
    expect(head.headers['content-length']).toBe('20')
    expect(head.payload).toBe('')
    const cached = await app.inject({ method: 'GET', url, headers: { 'if-none-match': head.headers.etag as string } })
    expect(cached.statusCode).toBe(304)
    expect(cached.payload).toBe('')
  })

  it('404 for unknown or unsafe keys', async () => {
    for (const url of ['/uploads/00000000-0000-0000-0000-000000000000.webm', '/uploads/..%2F.env', '/uploads/x'])
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404)
  })
})

describe('parseRange', () => {
  it('resolves single ranges against the size', () => {
    expect(parseRange(undefined, 10)).toBeNull()
    expect(parseRange('bytes=0-0', 10)).toEqual({ start: 0, end: 0 })
    expect(parseRange('bytes=-20', 10)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable')
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable')
    expect(parseRange('bytes=5-2', 10)).toBeNull()
    expect(parseRange('items=0-1', 10)).toBeNull()
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

describe('deleteMedia', () => {
  const remove = (userId: string, id: string) => app.inject({ method: 'DELETE', url: `/media/${id}`, headers: asAuth(userId) })

  it('the owner deletes an unused upload and its file', async () => {
    const files = readdirSync(UPLOADS_DIR).length
    const media = (await upload(testUserId)).json().data
    expect(readdirSync(UPLOADS_DIR).length).toBe(files + 1)
    expect((await remove(testUserId, media.id)).statusCode).toBe(204)
    expect(await db.media.findUnique({ where: { id: media.id } })).toBeNull()
    expect(readdirSync(UPLOADS_DIR).length).toBe(files)
  })

  it('404 for someone else\'s upload; 409 once attached or used as a thumbnail', async () => {
    const theirs = (await upload(testOtherUserId)).json().data
    expect((await remove(testUserId, theirs.id)).statusCode).toBe(404)

    const room = await seedRoom(app, testUserId)
    const attached = (await upload(testUserId)).json().data
    await seedItem(app, testUserId, room.id, { mediaIds: [attached.id] })
    expect((await remove(testUserId, attached.id)).json().code).toBe('MEDIA_IN_USE')

    const thumb = (await upload(testUserId, { type: 'image/png', fields: {} })).json().data
    await db.room.update({ where: { id: room.id }, data: { thumbnailId: thumb.id } })
    expect((await remove(testUserId, thumb.id)).statusCode).toBe(409)
  })
})
