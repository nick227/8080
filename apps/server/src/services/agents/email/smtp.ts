// "Use my own email" through SMTP (docs/agents/07 S5): the business's own mailbox,
// usually with an app password. Same EmailProvider interface; Agent code is unchanged.
// Credentials live encrypted on the connection (lib/secrets.ts) and are decrypted
// only here, per send.
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import nodemailer, { type Transporter } from 'nodemailer'
import type { EmailConnection } from '@project/db'
import { decryptSecret } from '../../../lib/secrets'
import { formatFrom, type EmailProvider, type OutboundEmail, type SendFailure, type SendResult, type TestResult } from './provider'

/** implicit = TLS from the first byte (465); starttls = upgrade after connecting (587/25/2525). */
export type SmtpSecurity = 'implicit' | 'starttls'
export type SmtpSecret = { host: string; port: number; security: SmtpSecurity; username: string; password: string }

export const SMTP_PORTS = [25, 465, 587, 2525] as const

type Transport = Pick<Transporter, 'verify' | 'sendMail' | 'close'>
type TransportFactory = (options: Record<string, unknown>) => Transport

let factory: TransportFactory = (options) => nodemailer.createTransport(options)
/** Tests may point SMTP at a local server with relaxed TLS; null restores the default. */
export function setSmtpTransportFactory(next: TransportFactory | null) {
  factory = next ?? ((options) => nodemailer.createTransport(options))
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./]
const isPrivate = (address: string) =>
  isIP(address) === 6
    ? address === '::1' || /^f[cd]/i.test(address) || /^fe80/i.test(address) || /^::ffff:/i.test(address)
    : PRIVATE_V4.some((re) => re.test(address))

/**
 * A user-supplied host must be a public mail server: only mail ports, and (in
 * production) no private, loopback or link-local address — so a connection can't be
 * used to reach this server's internal network.
 */
export async function smtpHostProblem(host: string, port: number): Promise<string | null> {
  if (!(SMTP_PORTS as readonly number[]).includes(port)) return `Use a mail port (${SMTP_PORTS.join(', ')})`
  if (!/^[a-z0-9.-]+$/i.test(host) || host.length > 253) return 'Enter the mail server name, like smtp.gmail.com'
  if (process.env.NODE_ENV !== 'production') return null
  try {
    const addresses = await lookup(host, { all: true })
    if (!addresses.length || addresses.some((a) => isPrivate(a.address))) return 'That mail server is not reachable from here'
  } catch {
    return 'That mail server name does not resolve'
  }
  return null
}

function transportFor(secret: SmtpSecret) {
  return factory({
    host: secret.host,
    port: secret.port,
    secure: secret.security === 'implicit',
    requireTLS: secret.security === 'starttls',
    auth: { user: secret.username, pass: secret.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  })
}

/** nodemailer errors → transient / permanent / auth. */
export function classifySmtpError(err: unknown): SendFailure {
  const e = err as { code?: string; responseCode?: number; message?: string }
  const message = (e.message ?? 'SMTP error').replace(/\s+/g, ' ').slice(0, 300)
  if (e.code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534) return { ok: false, kind: 'auth', code: 'SMTP_AUTH', message }
  if (typeof e.responseCode === 'number') {
    if (e.responseCode >= 400 && e.responseCode < 500) return { ok: false, kind: 'transient', code: `SMTP_${e.responseCode}`, message }
    if (e.responseCode >= 500) return { ok: false, kind: 'permanent', code: `SMTP_${e.responseCode}`, message }
  }
  if (e.code === 'ETLS') return { ok: false, kind: 'auth', code: 'SMTP_TLS', message }
  return { ok: false, kind: 'transient', code: `SMTP_${e.code ?? 'ERROR'}`.slice(0, 64), message }
}

export class SmtpProvider implements EmailProvider {
  readonly name = 'smtp'

  private secret(connection: EmailConnection): SmtpSecret | null {
    if (!connection.secret) return null
    try {
      return decryptSecret<SmtpSecret>(connection.secret)
    } catch {
      return null
    }
  }

  async test(connection: EmailConnection): Promise<TestResult> {
    const secret = this.secret(connection)
    if (!secret || !connection.fromAddress) return { ok: false, code: 'SMTP_NOT_CONFIGURED', message: 'This sender is missing its mail server details.', kind: 'auth' }
    const problem = await smtpHostProblem(secret.host, secret.port)
    if (problem) return { ok: false, code: 'SMTP_HOST_REFUSED', message: problem, kind: 'auth' }
    const transport = transportFor(secret)
    try {
      await transport.verify()
      return { ok: true }
    } catch (err) {
      const failure = classifySmtpError(err)
      return { ok: false, code: failure.code, message: failure.message, kind: failure.kind }
    } finally {
      transport.close()
    }
  }

  async send(connection: EmailConnection, email: OutboundEmail): Promise<SendResult> {
    const secret = this.secret(connection)
    if (!secret || !connection.fromAddress) return { ok: false, kind: 'auth', code: 'SMTP_NOT_CONFIGURED', message: 'This sender is missing its mail server details.' }
    const problem = await smtpHostProblem(secret.host, secret.port)
    if (problem) return { ok: false, kind: 'auth', code: 'SMTP_HOST_REFUSED', message: problem }
    const transport = transportFor(secret)
    try {
      const domain = connection.fromAddress.split('@')[1] ?? 'localhost'
      const info = await transport.sendMail({
        from: formatFrom(connection.displayName, connection.fromAddress),
        to: email.to,
        replyTo: connection.replyTo ?? undefined,
        subject: email.subject,
        text: email.text,
        ...(email.html ? { html: email.html } : {}),
        headers: email.headers,
        // SMTP has no idempotency key; a stable Message-ID lets receivers drop a duplicate.
        ...(email.idempotencyKey ? { messageId: `<${email.idempotencyKey.replace(/[^a-z0-9.:-]/gi, '-')}@${domain}>` } : {}),
      })
      return { ok: true, providerMessageId: String(info.messageId ?? '').slice(0, 255) || 'smtp' }
    } catch (err) {
      return classifySmtpError(err)
    } finally {
      transport.close()
    }
  }
}
