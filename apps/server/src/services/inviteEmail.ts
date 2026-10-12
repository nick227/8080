// Invite emails: the link to join a workspace, sent once right after the invite is
// created, through the workspace's default sender. No retry sweep: the person who
// invited sees the result at once and can Resend (a new invite) or copy the link.
import type { Workspace } from '@project/db'
import { defaultConnection } from './agents/connections'
import { providerFor } from './agents/email'
import { baseValues } from './agents/audiences'
import { renderEmail } from './agents/presentation'

export type InviteEmailResult = { emailed: boolean; emailError: string | null }

/** The app's public origin (never taken from the request: the link must point at us). */
export function appUrl() {
  const url = (process.env.APP_URL ?? process.env.CORS_ORIGIN ?? '').split(',')[0]?.trim()
  return url && /^https?:\/\//.test(url) ? url.replace(/\/$/, '') : null
}

export const inviteUrl = (base: string, token: string) => `${base}/invite/${encodeURIComponent(token)}`

/** Never throws: a failed send leaves the invite valid and says why. */
export async function sendInviteEmail(
  workspace: Workspace,
  invite: { id: string; email: string; role: string },
  token: string,
  inviterName: string | null,
): Promise<InviteEmailResult> {
  const base = appUrl()
  if (!base) return { emailed: false, emailError: 'NO_APP_URL' }
  const who = inviterName?.trim() || 'Someone'
  const as = invite.role === 'admin' ? 'an admin' : 'a member'
  const rendered = renderEmail({
    subject: `${who} invited you to {{workspace.name}}`,
    content: {
      version: 1,
      blocks: [
        { type: 'text', text: `${who} invited you to join {{workspace.name}} as ${as}.` },
        { type: 'button', label: 'Accept the invite', href: inviteUrl(base, token) },
        { type: 'text', text: `Sign in or create an account with ${invite.email} to accept. The link expires in 7 days.` },
      ],
    },
    template: 'transactional',
    theme: 'company',
    values: await baseValues(workspace),
    footer: ['You got this because someone at {{workspace.name}} entered your email address. If you weren’t expecting it, ignore it.'],
  })
  try {
    const connection = await defaultConnection(workspace.id)
    const result = await providerFor(connection).send(connection, {
      to: invite.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `workspace-invite:${invite.id}`,
    })
    return result.ok ? { emailed: true, emailError: null } : { emailed: false, emailError: result.code.slice(0, 200) }
  } catch (err) {
    console.error('invite email: send failed', err)
    return { emailed: false, emailError: 'SEND_ERROR' }
  }
}
