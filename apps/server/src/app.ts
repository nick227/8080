import Fastify, { type FastifyServerOptions } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import openapiGlue from 'fastify-openapi-glue'
import { load } from 'js-yaml'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import * as handlers from './handlers'
import * as security from './plugins/security'
import uploads from './plugins/uploads'

export const specPath = resolve(__dirname, '../../../packages/api-spec/openapi.yaml')

type BuildOptions = {
  logger?: FastifyServerOptions['logger']
  // Tests swap in a header-only auth handler; everything else is identical to prod.
  securityHandlers?: Record<string, (request: any, reply: any, params: any) => Promise<void>>
  docs?: boolean
  // Tests disable limits (every inject shares 127.0.0.1); one test re-enables them.
  rateLimit?: boolean
}

// Shared by index.ts (prod/dev) and __tests__/helpers so tests run the real plugin
// stack: multipart, rate limits, error mapping, spec-driven routing.
export async function buildApp(opts: BuildOptions = {}) {
  const server = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true, // Railway terminates TLS; client IPs come from X-Forwarded-For
    // Reject unknown body fields (400) instead of silently stripping them, so a stale
    // client (e.g. sending parentId to sendMessage) fails loudly rather than misbehaving.
    ajv: { customOptions: { removeAdditional: false } },
  })

  // CORS first so preflight OPTIONS is handled before routing.
  // credentials: true is required for httpOnly cookie auth across origins.
  await server.register(cors, {
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
    credentials: true,
  })

  // Cookies before glue so request.cookies is populated.
  await server.register(cookie, { secret: process.env.SESSION_SECRET })

  // Per-route limits come from `x-fastify-config.rateLimit` in the spec.
  // RATE_LIMITS=off is for local multi-browser testing only; never set it in production.
  if (opts.rateLimit ?? process.env.RATE_LIMITS !== 'off') await server.register(rateLimit, { global: false })

  await server.register(uploads)

  if (opts.docs ?? process.env.NODE_ENV !== 'production') {
    const spec = load(readFileSync(specPath, 'utf-8')) as object
    await server.register(swagger, { openapi: spec as any })
    await server.register(swaggerUi, { routePrefix: '/docs' })
  }

  // Global error handler — services throw { statusCode, message, code? }.
  server.setErrorHandler((error: any, request, reply) => {
    if (error.validation) {
      return reply.status(400).send({ error: 'Validation failed', code: 'VALIDATION', details: error.validation })
    }
    if (error.code === 'P2025') return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' })
    if (error.code === 'P2002') return reply.status(409).send({ error: 'Already exists', code: 'CONFLICT' })
    // 502: an upstream we depend on (e.g. YouTube lookup) failed; 503: a feature isn't
    // configured on this server (e.g. live video) — surface their codes.
    if (error.statusCode && (error.statusCode < 500 || error.statusCode === 502 || error.statusCode === 503)) {
      const code = typeof error.code === 'string' && !error.code.startsWith('FST_') ? error.code : undefined
      return reply.status(error.statusCode).send({ error: error.message, ...(code ? { code } : {}) })
    }
    request.log.error(error)
    return reply.status(500).send({ error: 'Internal server error' })
  })

  // Spec-driven routing — operationId → handler export, security scheme → handler.
  // The OpenAPI spec lists text/event-stream request/response media types; openapi-glue
  // looks up a parser for each. SSE routes are GET-only, so this is never used for bodies.
  server.addContentTypeParser('text/event-stream', { parseAs: 'string' }, (_req, body, done) => done(null, body))

  server.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))))

  await server.register(openapiGlue, {
    specification: specPath,
    serviceHandlers: handlers,
    securityHandlers: opts.securityHandlers ?? security,
    noAdditional: true,
  } as any)

  // Liveness — not in spec, always public.
  server.get('/health', async () => ({ status: 'ok' }))

  // Alias routes for /api prefix on OAuth callbacks
  server.get('/api/auth/google/callback', handlers.handleGoogleLoginCallback)
  server.get('/api/integrations/google/callback', handlers.handleGoogleGmailCallback)
  server.get('/workspaces/:workspaceId/integrations/google/url', handlers.getGoogleGmailUrl)

  // Bot tuning endpoints (doc/08 R25): local opt-in only, never in production.
  if (process.env.BOTS_DEV === '1' && process.env.NODE_ENV !== 'production') {
    await server.register((await import('./plugins/devBots')).default)
  }
  // Dev outbox viewer (docs/agents/07 S0): local opt-in only, never in production.
  if (process.env.EMAIL_OUTBOX_DEV === '1' && process.env.NODE_ENV !== 'production') {
    await server.register((await import('./plugins/devEmailOutbox')).default)
  }

  return server
}
