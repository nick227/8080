import { createHash, randomBytes } from 'crypto'
import { db, type Prisma } from '@project/db'
import { badRequest } from '../../lib/errors'
import { isEmailAddress } from './email/provider'

export const normalizeRecipientEmail = (address: string) => address.trim().toLowerCase()
export function unsubscribeBaseUrl(): string {
  const raw = process.env.PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001')
  let url: URL
  try { url = new URL(raw) } catch { throw badRequest('Set PUBLIC_API_URL before sending customer emails', 'UNSUBSCRIBE_NOT_CONFIGURED') }
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw badRequest('Customer email requires a public HTTPS unsubscribe URL', 'UNSUBSCRIBE_NOT_CONFIGURED')
  return url.toString().replace(/\/$/, '')
}
export async function suppressionFor(tx: Prisma.TransactionClient | typeof db, workspaceId: string, address: string) {
  return tx.agentEmailSuppression.findUnique({ where: { workspaceId_address: { workspaceId, address: normalizeRecipientEmail(address) } } })
}
export async function suppressEmail(tx: Prisma.TransactionClient | typeof db, workspaceId: string, email: string, reason: 'unsubscribed' | 'manual' | 'bounce' | 'complaint') {
  const address = normalizeRecipientEmail(email)
  if (!isEmailAddress(address)) throw badRequest('A valid email is required', 'INVALID_EMAIL')
  return tx.agentEmailSuppression.upsert({ where: { workspaceId_address: { workspaceId, address } }, create: { workspaceId, address, reason }, update: {} })
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex')
export async function createUnsubscribeLink(tx: Prisma.TransactionClient, workspaceId: string, email: string) {
  const base = unsubscribeBaseUrl()
  const token = randomBytes(32).toString('hex')
  await tx.agentUnsubscribeToken.create({ data: { tokenHash: digest(token), workspaceId, address: normalizeRecipientEmail(email) } })
  return `${base}/agent-unsubscribe/${token}`
}
export async function unsubscribe(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw badRequest('This unsubscribe link is invalid', 'INVALID_UNSUBSCRIBE_LINK')
  return db.$transaction(async tx => {
    const row = await tx.agentUnsubscribeToken.findUnique({ where: { tokenHash: digest(token) } })
    if (!row) throw badRequest('This unsubscribe link is invalid', 'INVALID_UNSUBSCRIBE_LINK')
    await suppressEmail(tx, row.workspaceId, row.address, 'unsubscribed')
    return { ok: true }
  })
}
