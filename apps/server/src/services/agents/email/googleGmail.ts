import type { EmailConnection } from '@project/db'
import { db } from '@project/db'
import { decryptSecret, encryptSecret } from '../../../lib/secrets'
import { refreshGoogleAccessToken } from '../../googleAuth'
import { formatFrom, type EmailProvider, type OutboundEmail, type SendFailure, type SendResult, type TestResult } from './provider'

export type GoogleSecret = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  emailAddress: string
  scope?: string
}

export class GoogleGmailProvider implements EmailProvider {
  readonly name = 'google'

  private secret(connection: EmailConnection): GoogleSecret | null {
    if (!connection.secret) return null
    try {
      return decryptSecret<GoogleSecret>(connection.secret)
    } catch {
      return null
    }
  }

  private async getValidAccessToken(connection: EmailConnection): Promise<{ secret: GoogleSecret; accessToken: string } | SendFailure> {
    const secret = this.secret(connection)
    if (!secret || !secret.emailAddress) {
      return { ok: false, kind: 'auth', code: 'GMAIL_NOT_CONFIGURED', message: 'Gmail account is not connected.' }
    }

    // Check if access token is valid (with 60-second safety margin)
    if (Date.now() < secret.expiresAt - 60_000 && secret.accessToken) {
      return { secret, accessToken: secret.accessToken }
    }

    // Access token is expired, attempt to refresh using refresh token
    if (!secret.refreshToken) {
      await db.emailConnection.update({
        where: { id: connection.id },
        data: { status: 'needs_attention', lastError: 'Google session expired. Please reconnect Gmail.' },
      })
      return { ok: false, kind: 'auth', code: 'GMAIL_AUTH_EXPIRED', message: 'Google session expired. Please reconnect Gmail.' }
    }

    try {
      const refreshed = await refreshGoogleAccessToken(secret.refreshToken)
      secret.accessToken = refreshed.accessToken
      secret.expiresAt = Date.now() + refreshed.expiresIn * 1000

      // Persist updated credentials back to database
      await db.emailConnection.update({
        where: { id: connection.id },
        data: {
          secret: encryptSecret(secret),
          status: 'active',
          lastError: null,
        },
      })

      return { secret, accessToken: secret.accessToken }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Token refresh failed'
      await db.emailConnection.update({
        where: { id: connection.id },
        data: { status: 'needs_attention', lastError: `Gmail token refresh failed: ${msg}` },
      })
      return { ok: false, kind: 'auth', code: 'GMAIL_REFRESH_FAILED', message: `Gmail authentication error: ${msg}` }
    }
  }

  async test(connection: EmailConnection): Promise<TestResult> {
    const tokenResult = await this.getValidAccessToken(connection)
    if ('ok' in tokenResult && !tokenResult.ok) {
      return tokenResult
    }

    const { accessToken } = tokenResult as { secret: GoogleSecret; accessToken: string }

    try {
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!res.ok) {
        const errorText = await res.text()
        return { ok: false, code: 'GMAIL_PROFILE_ERROR', message: `Gmail verification failed: ${errorText}`, kind: 'auth' }
      }

      return { ok: true }
    } catch (err) {
      return { ok: false, code: 'GMAIL_NETWORK_ERROR', message: err instanceof Error ? err.message : 'Network error verifying Gmail profile' }
    }
  }

  async send(connection: EmailConnection, email: OutboundEmail): Promise<SendResult> {
    const tokenResult = await this.getValidAccessToken(connection)
    if ('ok' in tokenResult && !tokenResult.ok) {
      return tokenResult
    }

    const { secret, accessToken } = tokenResult as { secret: GoogleSecret; accessToken: string }

    // Enforce send-as boundary: must send from the authorized Gmail address
    const fromAddr = connection.fromAddress?.trim() || secret.emailAddress
    const fromHeader = formatFrom(connection.displayName || secret.emailAddress.split('@')[0]!, fromAddr)

    // Build RFC 2822 MIME raw message
    const mimeLines = [
      `From: ${fromHeader}`,
      `To: ${email.to}`,
      ...(connection.replyTo ? [`Reply-To: ${connection.replyTo}`] : []),
      `Subject: ${email.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      email.html || email.text || '',
    ]

    const rawMime = mimeLines.join('\r\n')
    const encodedRaw = Buffer.from(rawMime, 'utf-8').toString('base64url')

    try {
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: encodedRaw }),
      })

      if (!res.ok) {
        const errText = await res.text()
        let parsed: { error?: { code?: number; message?: string; status?: string } } = {}
        try {
          parsed = JSON.parse(errText)
        } catch {
          // ignore
        }

        const msg = parsed.error?.message || errText || 'Gmail send failed'
        const code = parsed.error?.status || `GMAIL_SEND_${res.status}`

        if (res.status === 401 || res.status === 403) {
          await db.emailConnection.update({
            where: { id: connection.id },
            data: { status: 'needs_attention', lastError: msg.slice(0, 500) },
          })
          return { ok: false, kind: 'auth', code, message: msg }
        }

        return { ok: false, kind: 'transient', code, message: msg }
      }

      const data = (await res.json()) as { id?: string }
      return { ok: true, providerMessageId: data.id || 'gmail-sent' }
    } catch (err) {
      return {
        ok: false,
        kind: 'transient',
        code: 'GMAIL_SEND_ERROR',
        message: err instanceof Error ? err.message : 'Unknown Gmail send error',
      }
    }
  }
}
