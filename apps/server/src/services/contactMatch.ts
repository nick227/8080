// The one contact/account matcher (doc/09 §4.1, D2). Email and domain are strong
// match signals, never identity: exactly one live, non-shared candidate is a
// match; several are ambiguous (a person decides); shared/role addresses never
// auto-match. Used by manual create (possible duplicates) and, later, import,
// inbox and calendar resolution — none of which may create people from an email.
import { db, Prisma, type ContactPointKind } from '@project/db'
import { badRequest } from '../lib/errors'

type Client = Prisma.TransactionClient | typeof db

// Local parts that name a function, not a person.
const ROLE_LOCAL_PARTS = new Set([
  'info', 'sales', 'support', 'hello', 'contact', 'admin', 'office', 'team', 'noreply', 'no-reply', 'billing',
  'accounts', 'accounting', 'marketing', 'help', 'enquiries', 'inquiries', 'careers', 'jobs', 'press', 'media',
  'hr', 'webmaster', 'postmaster', 'service', 'orders', 'feedback', 'partners', 'legal', 'privacy', 'security',
])

// Personal mailbox providers: never an organisation's domain.
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com',
  'yandex.com', 'yandex.ru', 'zoho.com', 'fastmail.com', 'hey.com', 'qq.com', '163.com',
])

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export function emailDomain(email: string) {
  return normalizeEmail(email).split('@')[1] ?? ''
}

export const isRoleAddress = (email: string) => ROLE_LOCAL_PARTS.has(normalizeEmail(email).split('@')[0]!.split('+')[0]!)
export const isFreeMailDomain = (domain: string) => FREE_MAIL_DOMAINS.has(domain)

/** "https://www.Acme.com/about" → "acme.com"; null when it isn't a domain. */
export function normalizeDomain(value: string): string | null {
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split(/[/?#]/)[0]!
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '')
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null
}

/** The value a point is matched and deduplicated by. Throws 400 for an invalid email. */
export function normalizePoint(kind: ContactPointKind, value: string): string {
  const v = value.trim()
  switch (kind) {
    case 'email':
      if (!EMAIL.test(v)) throw badRequest(`"${v}" is not an email address`, 'INVALID_EMAIL')
      return normalizeEmail(v)
    case 'phone': {
      const digits = v.replace(/[^\d+]/g, '')
      return digits.startsWith('+') ? `+${digits.slice(1).replace(/\+/g, '')}` : digits.replace(/\+/g, '')
    }
    case 'url':
      return v.toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
    case 'social':
      return v.toLowerCase().replace(/^@/, '')
  }
}

export type MatchResult = 'match' | 'none' | 'ambiguous' | 'shared'

/** Live contacts holding this email, and what the matcher concludes. */
export async function matchContactsByEmail(client: Client, workspaceId: string, email: string) {
  const normalized = normalizeEmail(email)
  const points = await client.contactPoint.findMany({
    where: { workspaceId, kind: 'email', normalized, live: true },
    select: { contactId: true, shared: true },
  })
  const personal = [...new Set(points.filter((p) => !p.shared).map((p) => p.contactId))]
  const all = [...new Set(points.map((p) => p.contactId))]
  const result: MatchResult =
    personal.length === 1 ? 'match' : personal.length > 1 ? 'ambiguous' : all.length > 0 ? 'shared' : 'none'
  return { result, contactIds: all, matchId: result === 'match' ? personal[0]! : null }
}

/** Live accounts with this domain; free-mail domains never match. */
export async function matchAccountsByDomain(client: Client, workspaceId: string, domain: string) {
  const key = normalizeDomain(domain)
  if (!key || isFreeMailDomain(key)) return { result: 'none' as MatchResult, accountIds: [] as string[], matchId: null }
  const accounts = await client.account.findMany({ where: { workspaceId, domainKey: key, deletedAt: null }, select: { id: true } })
  const result: MatchResult = accounts.length === 1 ? 'match' : accounts.length > 1 ? 'ambiguous' : 'none'
  return { result, accountIds: accounts.map((a) => a.id), matchId: result === 'match' ? accounts[0]!.id : null }
}
