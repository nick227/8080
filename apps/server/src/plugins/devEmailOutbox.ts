// Dev-only view of what the DevOutbox provider "sent" (docs/agents/07 S0). Registered
// only with EMAIL_OUTBOX_DEV=1 outside production; outside the OpenAPI contract on
// purpose. No auth — local use only.
//   GET /dev/email-outbox?to=&limit=   newest first (no bodies)
//   GET /dev/email-outbox/:id          the email as rendered HTML (?format=text for text)
import type { FastifyInstance } from 'fastify'
import { db } from '@project/db'

export default async function devEmailOutbox(server: FastifyInstance) {
  server.get('/dev/email-outbox', async (request: any) => {
    const to = typeof request.query?.to === 'string' ? request.query.to : undefined
    const limit = Math.min(Number(request.query?.limit) || 50, 200)
    const rows = await db.devOutboxEmail.findMany({
      where: to ? { to } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, workspaceId: true, from: true, replyTo: true, to: true, subject: true, createdAt: true },
    })
    return { data: rows }
  })

  server.get('/dev/email-outbox/:id', async (request: any, reply) => {
    const row = await db.devOutboxEmail.findUnique({ where: { id: String(request.params.id) } })
    if (!row) return reply.code(404).send({ error: 'Not found' })
    if (request.query?.format === 'text' || !row.html) return reply.type('text/plain; charset=utf-8').send(`From: ${row.from}\nReply-To: ${row.replyTo ?? ''}\nTo: ${row.to}\nSubject: ${row.subject}\n\n${row.text}`)
    return reply.type('text/html; charset=utf-8').send(row.html)
  })
}
