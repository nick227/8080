import { beforeAll, beforeEach, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import SwaggerParser from '@apidevtools/swagger-parser'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { db } from '@project/db'
import { buildApp, specPath } from '../../app'
import { bearerAuth as realBearerAuth } from '../../plugins/security'
import { userInclude } from '../../lib/session'

// Two seeded users available in every test — use testOtherUserId for
// cross-user permission tests. Alice is a registered account, Bob a guest.
export const testUserId = '00000000-0000-0000-0000-000000000001'
export const testOtherUserId = '00000000-0000-0000-0000-000000000002'

let derefSpec: any
async function getSpec() {
  if (!derefSpec) derefSpec = await SwaggerParser.dereference(specPath)
  return derefSpec
}

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

async function seedTestUsers() {
  await db.user.createMany({
    data: [
      { id: testUserId, email: 'alice@test.local', passwordHash: 'x', isGuest: false },
      { id: testOtherUserId, isGuest: true },
    ],
    skipDuplicates: true,
  })
  await db.profile.createMany({
    data: [
      { userId: testUserId, displayName: 'Alice' },
      { userId: testOtherUserId, displayName: 'Guest BOB' },
    ],
    skipDuplicates: true,
  })
}

export function buildTestApp(opts: { rateLimit?: boolean } = {}) {
  let app!: FastifyInstance
  // Proxy so test files can call app.inject() at module scope before beforeAll runs.
  const proxy = new Proxy({} as FastifyInstance, {
    get: (_t, key) => {
      const value = (app as any)[key]
      return typeof value === 'function' ? value.bind(app) : value
    },
  })

  beforeAll(async () => {
    app = await buildApp({
      docs: false,
      rateLimit: opts.rateLimit ?? false,
      logger: process.env.TEST_LOG ? { level: 'error' } : false,
      securityHandlers: {
        // Test auth: "Bearer <userId>" for a seeded user skips session lookup.
        // Anything else (real session cookies/tokens) goes through the real handler,
        // so guest/register/login flows are tested end-to-end.
        async bearerAuth(request: any, reply: any, params: any) {
          const id = request.headers.authorization?.replace(/^Bearer /, '')
          const user = id ? await db.user.findUnique({ where: { id }, include: userInclude }) : null
          if (user) {
            request.user = user
            return
          }
          await realBearerAuth(request, reply, params)
        },
      },
    })
    await app.ready()
  })

  beforeEach(async () => {
    await seedTestUsers()
  })

  afterAll(() => app?.close())

  return proxy
}

export function asAuth(userId: string) {
  return { Authorization: `Bearer ${userId}` }
}

export async function validateResponse(operationId: string, status: number, body: unknown) {
  const spec = await getSpec()
  for (const pathItem of Object.values<any>(spec.paths ?? {})) {
    for (const op of Object.values<any>(pathItem)) {
      if (op?.operationId !== operationId) continue
      const schema = op.responses?.[status]?.content?.['application/json']?.schema
      if (!schema) return
      const validate = ajv.compile(schema)
      if (!validate(body)) {
        throw new Error(
          `${operationId} ${status} response does not match spec:\n` + JSON.stringify(validate.errors, null, 2),
        )
      }
      return
    }
  }
  throw new Error(`Unknown operationId ${operationId}`)
}

// ─── domain seeds (go through the API so tests exercise real paths) ────────────

export async function seedRoom(
  app: FastifyInstance,
  ownerId: string,
  body: { title?: string; topic?: string; visibility?: 'public' | 'private' } = {},
) {
  const res = await app.inject({
    method: 'POST',
    url: '/rooms',
    headers: asAuth(ownerId),
    payload: { title: 'Test room', ...body },
  })
  if (res.statusCode !== 201) throw new Error(`seedRoom failed: ${res.statusCode} ${res.body}`)
  return res.json().data as { id: string; inviteCode: string | null; number: number }
}

export type SeededItem = { id: string; number: number; roomId: string; messageId: string; parentId: string | null }

export async function seedItem(
  app: FastifyInstance,
  authorId: string,
  roomId: string,
  body: { text?: string; mediaIds?: string[] } = { text: 'hello' },
) {
  const res = await app.inject({
    method: 'POST',
    url: `/rooms/${roomId}/items`,
    headers: asAuth(authorId),
    payload: body,
  })
  if (res.statusCode !== 201) throw new Error(`seedItem failed: ${res.statusCode} ${res.body}`)
  return res.json().data as SeededItem
}

export async function seedReply(
  app: FastifyInstance,
  authorId: string,
  parentItemId: string,
  body: { text?: string; mediaIds?: string[] } = { text: 'reply' },
) {
  const res = await app.inject({
    method: 'POST',
    url: `/items/${parentItemId}/replies`,
    headers: asAuth(authorId),
    payload: body,
  })
  if (res.statusCode !== 201) throw new Error(`seedReply failed: ${res.statusCode} ${res.body}`)
  return res.json().data as SeededItem
}

// Builds a multipart body without extra deps. Field order is preserved.
export function multipart(parts: Array<{ name: string; value: string | Buffer; filename?: string; type?: string }>) {
  const boundary = '----vctest' + Math.random().toString(16).slice(2)
  const chunks: Buffer[] = []
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`
    if (p.filename) head += `; filename="${p.filename}"`
    head += '\r\n'
    if (p.type) head += `Content-Type: ${p.type}\r\n`
    chunks.push(Buffer.from(head + '\r\n'), Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

// Uploads must start with their type's signature (MediaService checks it).
// Media URLs are /media/:id/playback (an authorized redirect); the bytes themselves
// are served at /uploads/<storageKey>.
export async function storedPath(mediaId: string) {
  return `/uploads/${(await db.media.findUniqueOrThrow({ where: { id: mediaId } })).storageKey}`
}

const SIGNATURE_HEX: Record<string, string> = {
  'audio/webm': '1a45dfa3',
  'video/webm': '1a45dfa3',
  'image/png': '89504e470d0a1a0a',
  'image/jpeg': 'ffd8ffe0',
  'image/gif': '474946383961',
}

/** `rest` behind a valid signature for `type` (codec parameters ignored); just `rest` for types we don't accept. */
export function fileBytes(type: string, rest: string | Buffer = 'test-bytes') {
  const hex = SIGNATURE_HEX[type.split(';')[0]!.trim()] ?? ''
  return Buffer.concat([Buffer.from(hex, 'hex'), Buffer.isBuffer(rest) ? rest : Buffer.from(rest)])
}
