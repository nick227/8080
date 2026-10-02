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
  if (opts.rateLimit ?? false) await server.register(rateLimit, { global: false })

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
    // 502: an upstream we depend on (e.g. YouTube lookup) failed — surface its code.
    if (error.statusCode && (error.statusCode < 500 || error.statusCode === 502)) {
      const code = typeof error.code === 'string' && !error.code.startsWith('FST_') ? error.code : undefined
      return reply.status(error.statusCode).send({ error: error.message, ...(code ? { code } : {}) })
    }
    request.log.error(error)
    return reply.status(500).send({ error: 'Internal server error' })
  })

  // Spec-driven routing — operationId → handler export, security scheme → handler.
  await server.register(openapiGlue, {
    specification: specPath,
    serviceHandlers: handlers,
    securityHandlers: opts.securityHandlers ?? security,
    noAdditional: true,
  } as any)

  // Liveness — not in spec, always public.
  server.get('/health', async () => ({ status: 'ok' }))

  return server
}
