// Picks the provider for a connection. "Send with 8080" (platform) and the first
// "use my own" strategy, SMTP; Google, Microsoft and Resend domain come later.
import type { EmailConnection } from '@project/db'
import { DevOutboxProvider } from './devOutbox'
import { ResendPlatformProvider } from './resendPlatform'
import { platformFrom } from './platform'
import { SmtpProvider } from './smtp'
import { GoogleGmailProvider } from './googleGmail'
import type { EmailProvider } from './provider'

export * from './provider'
export { platformIdentity, platformFromAddress, platformFrom, parseFrom } from './platform'

/**
 * Which transport platform sends use:
 * - production: always Resend. Missing configuration fails every send visibly
 *   (PLATFORM_NOT_CONFIGURED); it never falls back to the dev outbox.
 * - tests: always the dev outbox (tests swap providers with setEmailProvider).
 * - local dev: the dev outbox, unless EMAIL_TRANSPORT=resend asks for real sends.
 */
export function emailTransport(): 'dev' | 'resend' {
  if (process.env.NODE_ENV === 'production') return 'resend'
  if (process.env.NODE_ENV === 'test') return 'dev'
  return process.env.EMAIL_TRANSPORT?.trim() === 'resend' ? 'resend' : 'dev'
}

/** One startup line about email: names what is missing, never prints the key. */
export function describeEmailSetup(): { ok: boolean; line: string } {
  const transport = emailTransport()
  const from = platformFrom()
  if (transport === 'dev') return { ok: true, line: `email: dev outbox (from ${from?.address ?? 'unset'})` }
  const missing = [
    ...(process.env.RESEND_API_KEY?.trim() ? [] : ['RESEND_API_KEY']),
    ...(from ? [] : [process.env.EMAIL_PLATFORM_FROM?.trim() ? 'EMAIL_PLATFORM_FROM (not an email address)' : 'EMAIL_PLATFORM_FROM']),
  ]
  if (missing.length) return { ok: false, line: `email: Resend NOT CONFIGURED — missing ${missing.join(', ')}; every platform send will fail` }
  return { ok: true, line: `email: Resend, from ${from!.address}` }
}

let override: EmailProvider | null = null
/** Tests swap the provider (null restores the default). */
export function setEmailProvider(provider: EmailProvider | null) {
  override = provider
}

const dev = new DevOutboxProvider()
const smtp = new SmtpProvider()
const google = new GoogleGmailProvider()

/**
 * The platform follows emailTransport(). An own SMTP or Google sender always sends using its credentials.
 */
export function providerFor(connection: EmailConnection): EmailProvider {
  if (override) return override
  if (connection.strategy === 'smtp') return smtp
  if (connection.strategy === 'google') return google
  if (connection.strategy !== 'platform') throw new Error(`Email strategy ${connection.strategy} is not available yet`)
  return emailTransport() === 'resend' ? new ResendPlatformProvider() : dev
}

