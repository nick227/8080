// One interface for every sender (docs/agents/07 decision 3). Agent code calls
// providerFor(connection) and never branches on the strategy behind it.
import type { EmailConnection } from '@project/db'

export type OutboundEmail = {
  to: string
  subject: string
  /** Empty = text-only (the Plain text template). */
  html: string
  text: string
  headers?: Record<string, string>
  /** Same key = same email; the provider sends it at most once. */
  idempotencyKey?: string
}

/** transient = may succeed on a later attempt; auth = the connection itself is broken. */
export type SendFailure = { ok: false; kind: 'transient' | 'permanent' | 'auth'; code: string; message: string }
export type SendResult = { ok: true; providerMessageId: string } | SendFailure
export type TestResult = { ok: true } | { ok: false; code: string; message: string }

export interface EmailProvider {
  readonly name: string
  /** Checks the connection can send, without sending. */
  test(connection: EmailConnection): Promise<TestResult>
  send(connection: EmailConnection, email: OutboundEmail): Promise<SendResult>
}

/** The From/Reply-To a connection sends as. */
export type SenderIdentity = { from: string; fromAddress: string; displayName: string; replyTo: string | null }

/** Header-safe display name: no quotes, angle brackets or line breaks. */
export const safeDisplayName = (name: string) => name.replace(/["<>\r\n\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)

export const formatFrom = (displayName: string, address: string) => {
  const name = safeDisplayName(displayName)
  return name ? `"${name}" <${address}>` : address
}

export const EMAIL_ADDRESS = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/
export const isEmailAddress = (value: string) => value.length <= 254 && EMAIL_ADDRESS.test(value)
