import fp from 'fastify-plugin'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import { MAX_UPLOAD_BYTES } from '../services/MediaService'

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

  // Serve local uploads. Cloud providers serve from the bucket instead.
  if ((process.env.STORAGE_PROVIDER ?? 'local') === 'local') {
    const { UPLOADS_DIR } = await import('../providers/LocalStorageProvider')
    await server.register(staticFiles, {
      root: UPLOADS_DIR,
      prefix: '/uploads/',
      decorateReply: false,
      // Uploaded content is user-controlled: never let browsers sniff it into HTML.
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'; img-src 'self'")
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      },
    })
  }
})
