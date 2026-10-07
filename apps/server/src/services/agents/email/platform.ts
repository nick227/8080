// "Send with 8080" (docs/agents/07 decision 2): an 8080-controlled verified domain,
// the workspace's name as the display name and its real address as Reply-To.
// EMAIL_PLATFORM_FROM is `address` or `Name <address>`; the name is only a fallback
// when a sender has no display name of its own.
import type { EmailConnection } from '@project/db'
import { formatFrom, isEmailAddress, type SenderIdentity } from './provider'

const DEV_FROM = 'agents@8080.localhost'

export type PlatformFrom = { address: string; name: string | null }

/** Parses `address` / `Name <address>` / `"Name" <address>`; null if it isn't one. */
export function parseFrom(value: string): PlatformFrom | null {
  const trimmed = value.trim()
  const named = /^(?:"([^"]*)"|([^<]*?))\s*<([^<>\s]+)>$/.exec(trimmed)
  const address = named ? named[3]! : trimmed
  if (!isEmailAddress(address)) return null
  const name = named ? (named[1] ?? named[2] ?? '').trim() : ''
  return { address, name: name || null }
}

/** The configured platform sender; null when unset or invalid (production must set it). */
export function platformFrom(): PlatformFrom | null {
  const configured = process.env.EMAIL_PLATFORM_FROM?.trim()
  if (configured) return parseFrom(configured)
  return process.env.NODE_ENV === 'production' ? null : { address: DEV_FROM, name: null }
}

export const platformFromAddress = () => platformFrom()?.address ?? null

export function platformIdentity(connection: EmailConnection): SenderIdentity | null {
  const from = platformFrom()
  if (!from) return null
  const displayName = connection.displayName.trim() || from.name || ''
  return { from: formatFrom(displayName, from.address), fromAddress: from.address, displayName, replyTo: connection.replyTo }
}
