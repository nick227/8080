// Picks the provider for a connection. Only "Send with 8080" exists in S0; the
// "use my own" strategies (SMTP, Google, Microsoft, Resend domain) arrive in S5.
import type { EmailConnection } from '@project/db'
import { DevOutboxProvider } from './devOutbox'
import { ResendPlatformProvider } from './resendPlatform'
import type { EmailProvider } from './provider'

export * from './provider'
export { platformIdentity, platformFromAddress } from './platform'

/** dev = DevOutbox; resend = Resend. Default: dev in tests or without RESEND_API_KEY. */
export function emailTransport(): 'dev' | 'resend' {
  const set = process.env.EMAIL_TRANSPORT?.trim()
  if (set === 'dev' || set === 'resend') return set
  return process.env.NODE_ENV !== 'test' && process.env.RESEND_API_KEY ? 'resend' : 'dev'
}

let override: EmailProvider | null = null
/** Tests swap the provider (null restores the default). */
export function setEmailProvider(provider: EmailProvider | null) {
  override = provider
}

const dev = new DevOutboxProvider()

export function providerFor(connection: EmailConnection): EmailProvider {
  if (override) return override
  if (connection.strategy !== 'platform') throw new Error(`Email strategy ${connection.strategy} is not available yet`)
  return emailTransport() === 'resend' ? new ResendPlatformProvider() : dev
}
