import fp from 'fastify-plugin'
import multipart from '@fastify/multipart'
import { db } from '@project/db'
import { parseRange } from '../lib/range'
import { MAX_UPLOAD_BYTES } from '../services/MediaService'
import { SAFE_KEY, storage } from '../providers/storage'

// Register before fastify-openapi-glue.
export default fp(async (server) => {
  await server.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
  })

  // Fastify validates multipart bodies against request.body, which @fastify/multipart
  // leaves undefined. The spec keeps the multipart schema for docs/SDK typing; the
  // handler validates parts itself. Strip only multipart body schemas.
  server.addHook('onRoute', (route) => {
    const body = route.schema?.body as any
    if (body?.content?.['multipart/form-data']) delete route.schema!.body
  })

  storage() // fail at boot, not on the first upload, if the provider is misconfigured

  // Uploaded media, streamed from whichever provider is configured (local disk or a
  // private bucket). Size and type come from the Media row, so serving costs one indexed
  // lookup and one storage read. Not in the spec: public, like /health.
  // HEAD is explicit: Fastify's automatic HEAD would open and drain the whole object.
  server.route({ method: ['GET', 'HEAD'], url: '/uploads/:key', handler: async (request: any, reply) => {
    const { key } = request.params as { key: string }
    const media = SAFE_KEY.test(key)
      ? await db.media.findUnique({ where: { storageKey: key }, select: { size: true, mimeType: true } })
      : null
    if (!media) return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' })

    const etag = `"${key}"` // keys are never reused, so the key is the version
    const cacheHeaders = { etag, 'cache-control': 'public, max-age=31536000, immutable' }
    if (request.headers['if-none-match'] === etag) return reply.status(304).headers(cacheHeaders).send()

    const range = parseRange(request.headers.range, media.size)
    if (range === 'unsatisfiable') {
      return reply.status(416).header('content-range', `bytes */${media.size}`).send()
    }

    // Read before setting media headers, so a missing object is a clean 404.
    const head = request.method === 'HEAD'
    const body = head ? null : await storage().read(key, range ?? undefined)
    if (!head && !body) return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' })

    reply.headers({
      ...cacheHeaders,
      // Uploaded content is user-controlled: never let browsers sniff it into HTML.
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; media-src 'self'; img-src 'self'",
      'cross-origin-resource-policy': 'cross-origin',
      'content-type': media.mimeType,
      'accept-ranges': 'bytes',
      'content-length': range ? range.end - range.start + 1 : media.size,
    })
    if (range) reply.status(206).header('content-range', `bytes ${range.start}-${range.end}/${media.size}`)
    return reply.send(body ?? undefined)
  } })
})
