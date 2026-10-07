// "Send with 8080" through Resend (docs/agents/07 decision 3). One platform API key
// and verified domain for every workspace; nothing per workspace is stored.
import type { EmailConnection } from '@project/db'
import { platformIdentity } from './platform'
import type { EmailProvider, OutboundEmail, SendResult, TestResult } from './provider'

const ENDPOINT = 'https://api.resend.com/emails'
const TIMEOUT_MS = 15_000

export class ResendPlatformProvider implements EmailProvider {
  readonly name = 'resend-platform'

  constructor(private readonly apiKey = process.env.RESEND_API_KEY ?? '') {}

  async test(connection: EmailConnection): Promise<TestResult> {
    if (!this.apiKey) return { ok: false, code: 'PLATFORM_NOT_CONFIGURED', message: 'Sending with 8080 is not set up on this server.' }
    if (!platformIdentity(connection)) return { ok: false, code: 'PLATFORM_NOT_CONFIGURED', message: 'The 8080 sending address is not set up on this server.' }
    return { ok: true }
  }

  async send(connection: EmailConnection, email: OutboundEmail): Promise<SendResult> {
    const identity = platformIdentity(connection)
    if (!this.apiKey || !identity) return { ok: false, kind: 'auth', code: 'PLATFORM_NOT_CONFIGURED', message: 'Sending with 8080 is not set up on this server.' }
    let res: Response
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...(email.idempotencyKey ? { 'Idempotency-Key': email.idempotencyKey.slice(0, 256) } : {}),
        },
        body: JSON.stringify({
          from: identity.from,
          to: [email.to],
          subject: email.subject,
          ...(email.html ? { html: email.html } : {}),
          text: email.text,
          ...(identity.replyTo ? { reply_to: identity.replyTo } : {}),
          ...(email.headers && Object.keys(email.headers).length ? { headers: email.headers } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      return { ok: false, kind: 'transient', code: 'NETWORK', message: (err as Error).message.slice(0, 300) }
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string }
    if (res.ok && body.id) return { ok: true, providerMessageId: body.id }
    const message = (body.message ?? `Resend answered ${res.status}`).slice(0, 300)
    const code = `RESEND_${(body.name ?? String(res.status)).toUpperCase()}`.slice(0, 64)
    if (res.status === 401 || res.status === 403) return { ok: false, kind: 'auth', code, message }
    if (res.status === 429 || res.status >= 500) return { ok: false, kind: 'transient', code, message }
    return { ok: false, kind: 'permanent', code, message }
  }
}
