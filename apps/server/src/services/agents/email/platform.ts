// "Send with 8080" (docs/agents/07 decision 2): an 8080-controlled verified domain,
// the workspace's name as the display name and its real address as Reply-To.
import type { EmailConnection } from '@project/db'
import { formatFrom, type SenderIdentity } from './provider'

const DEV_FROM = 'agents@8080.localhost'

/** Null when the platform address isn't configured (production must set it). */
export function platformFromAddress(): string | null {
  const configured = process.env.EMAIL_PLATFORM_FROM?.trim()
  if (configured) return configured
  return process.env.NODE_ENV === 'production' ? null : DEV_FROM
}

export function platformIdentity(connection: EmailConnection): SenderIdentity | null {
  const fromAddress = platformFromAddress()
  if (!fromAddress) return null
  return { from: formatFrom(connection.displayName, fromAddress), fromAddress, displayName: connection.displayName, replyTo: connection.replyTo }
}
