// The dev/test transport: "sends" by storing the email in DevOutboxEmail. Recipients
// whose local part starts with fail.transient / fail.permanent / fail.auth simulate
// those provider failures, so retry and failure paths can be exercised end to end.
import { db, type EmailConnection } from '@project/db'
import { platformIdentity } from './platform'
import type { EmailProvider, OutboundEmail, SendResult, TestResult } from './provider'

const SIMULATED = /^fail\.(transient|permanent|auth)[.+@]/

export class DevOutboxProvider implements EmailProvider {
  readonly name = 'dev-outbox'

  async test(connection: EmailConnection): Promise<TestResult> {
    return identityOf(connection) ? { ok: true } : { ok: false, code: 'SENDER_NOT_CONFIGURED', message: 'This sender has no From address.' }
  }

  async send(connection: EmailConnection, email: OutboundEmail): Promise<SendResult> {
    const identity = identityOf(connection)
    if (!identity) return { ok: false, kind: 'auth', code: 'SENDER_NOT_CONFIGURED', message: 'This sender has no From address.' }
    const simulated = SIMULATED.exec(email.to)?.[1] as 'transient' | 'permanent' | 'auth' | undefined
    if (simulated) return { ok: false, kind: simulated, code: `SIMULATED_${simulated.toUpperCase()}`, message: `Simulated ${simulated} failure` }
    if (email.idempotencyKey) {
      const sent = await db.devOutboxEmail.findUnique({ where: { idempotencyKey: email.idempotencyKey } })
      if (sent) return { ok: true, providerMessageId: `dev:${sent.id}` }
    }
    const row = await db.devOutboxEmail.create({
      data: {
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        from: identity.from,
        replyTo: identity.replyTo,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers ?? {},
        idempotencyKey: email.idempotencyKey ?? null,
      },
    })
    return { ok: true, providerMessageId: `dev:${row.id}` }
  }
}

function identityOf(connection: EmailConnection) {
  if (connection.strategy === 'platform') return platformIdentity(connection)
  return connection.fromAddress ? { from: connection.fromAddress, replyTo: connection.replyTo } : null
}
