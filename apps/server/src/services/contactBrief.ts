// Contact briefing (doc/13 D3): read-only intelligence before you contact someone.
// This file builds the bounded evidence pack (with the viewer's permissions), the
// deterministic template brief (the AI-off baseline), and the per-viewer cache whose
// pack hash tells whether a brief is stale. It never changes a business record.
//
// Pack = the contact + its accounts + notes (verbatim, with their facts) + timeline +
// recent messages in linked rooms the viewer can see + documents linked to those rooms.
import { createHash } from 'crypto'
import { db, type Prisma } from '@project/db'
import { notFound } from '../lib/errors'
import { authorize, documentVisibility } from './workspacePolicy'
import { timeline, visibleRoomIds } from './records'
import { subjectKey } from './actions'
import type { Brief, Claim, Evidence } from '../bots/assistant/provider'

const LIMITS = { notes: 12, activities: 20, messages: 15, documents: 3, text: 800, total: 16_000 }
const clip = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null)
const STAGE: Record<string, string> = { new: 'New', contacting: 'Contacting', connected: 'Connected', qualified: 'Qualified', customer: 'Customer', lost: 'Lost' }

/** What a brief may cite, plus where each piece can be opened in the app. */
export type PackItem = Evidence & { link: { type: 'room'; roomId: string } | { type: 'account'; id: string } | { type: 'document'; id: string } | null }

// Plain words for the timeline's activity types.
const ACTIVITY: Record<string, (s: Record<string, unknown>) => string> = {
  'contact.created': () => 'Added to contacts',
  'contact.updated': (s) => `Contact updated${Array.isArray(s.fields) && s.fields.length ? ` (${(s.fields as string[]).join(', ')})` : ''}`,
  'account.created': (s) => `Company added: ${s.name ?? ''}`,
  'note.added': (s) => `Note: ${s.excerpt ?? ''}`,
  'link.added': () => 'Linked to a conversation',
}

export async function buildPack(userId: string, workspaceId: string, contactId: string): Promise<{ contactName: string; pack: PackItem[] }> {
  await authorize(userId, workspaceId, 'record.read')
  const contact = await db.contact.findFirst({
    where: { id: contactId, workspaceId, deletedAt: null },
    include: { accounts: { where: { endedAt: null }, include: { account: true } }, points: { where: { live: true } } },
  })
  if (!contact) throw notFound('Contact not found')
  const pack: PackItem[] = []

  const emails = contact.points.filter((p) => p.kind === 'email').map((p) => p.value)
  const phones = contact.points.filter((p) => p.kind === 'phone').map((p) => p.value)
  pack.push({
    id: `contact:${contact.id}`, kind: 'contact', when: day(contact.createdAt), title: contact.displayName, link: null,
    text: [
      `Name: ${contact.displayName}`, contact.title ? `Title: ${contact.title}` : 'Title: not recorded',
      `Lead status: ${STAGE[contact.leadStatus ?? 'new'] ?? contact.leadStatus}`,
      `Next follow-up: ${day(contact.nextFollowUp) ?? 'not set'}`,
      `Email: ${emails.join(', ') || 'none on file'}`, `Phone: ${phones.join(', ') || 'none on file'}`,
      contact.leadSource ? `Source: ${contact.leadSource}` : '',
    ].filter(Boolean).join('. '),
  })
  for (const a of contact.accounts) {
    pack.push({
      id: `account:${a.account.id}`, kind: 'account', when: null, title: a.account.name, link: { type: 'account', id: a.account.id },
      text: [`Company: ${a.account.name}`, a.role ? `Role there: ${a.role}` : '', a.account.domain ? `Domain: ${a.account.domain}` : '', a.account.industry ? `Industry: ${a.account.industry}` : ''].filter(Boolean).join('. '),
    })
  }

  const notes = await db.note.findMany({
    where: { workspaceId, deletedAt: null, links: { some: { contactId } } },
    include: { message: true, authorMember: { include: { user: { include: { profile: true } } } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIMITS.notes,
  })
  for (const n of notes) {
    const facts = Array.isArray(n.facts) ? (n.facts as { key: string; value: string }[]).map((f) => `${f.key}: ${f.value}`).join('; ') : ''
    pack.push({
      id: `note:${n.id}`, kind: 'note', when: day(n.createdAt), title: `Note by ${n.authorMember.user.profile?.displayName ?? 'a member'}`, link: null,
      text: clip(`${n.message.text ?? ''}${facts ? ` (read: ${facts})` : ''}`, LIMITS.text),
    })
  }

  // The timeline, with rooms the viewer can't see already redacted.
  const activity = await timeline(userId, workspaceId, { subjectKey: subjectKey({ contactId }), contactId }, { limit: LIMITS.activities })
  for (const a of activity.data as { id: string; type: string; occurredAt: Date | string; summary: Record<string, unknown>; roomId: string | null }[]) {
    if (a.type === 'note.added') continue // the note itself is in the pack
    const say = ACTIVITY[a.type]
    pack.push({ id: `activity:${a.id}`, kind: 'activity', when: day(new Date(a.occurredAt)), title: a.type, text: clip(say ? say(a.summary ?? {}) : a.type, 300), link: a.roomId ? { type: 'room', roomId: a.roomId } : null })
  }

  // Conversations linked to the contact (rooms, or single messages in them), if visible.
  const links = await db.recordLink.findMany({ where: { workspaceId, contactId, OR: [{ roomId: { not: null } }, { itemId: { not: null } }] }, select: { roomId: true, itemId: true } })
  const itemRooms = links.some((l) => l.itemId) ? await db.item.findMany({ where: { id: { in: links.flatMap((l) => (l.itemId ? [l.itemId] : [])) } }, select: { id: true, roomId: true } }) : []
  const visible = await visibleRoomIds(userId, [...links.flatMap((l) => (l.roomId ? [l.roomId] : [])), ...itemRooms.map((i) => i.roomId)])
  const roomIds = [...visible]
  if (roomIds.length) {
    const items = await db.item.findMany({
      where: { roomId: { in: roomIds }, deletedAt: null, message: { text: { not: null }, deletedAt: null } },
      include: { message: { include: { author: { include: { profile: true } } } }, room: { select: { title: true, number: true } } },
      orderBy: { createdAt: 'desc' }, take: LIMITS.messages,
    })
    for (const i of items) {
      pack.push({
        id: `message:${i.id}`, kind: 'message', when: day(i.createdAt), link: { type: 'room', roomId: i.roomId },
        title: `${i.message.author.profile?.displayName ?? 'someone'} in ${i.room.title || `Conversation ${String(i.room.number).padStart(3, '0')}`}`,
        text: clip(i.message.text, 300),
      })
    }
    // Document access is per document: the workspace member, filtered by documentVisibility.
    const actor = await authorize(userId, workspaceId, 'workspace.read')
    const docs = await db.document.findMany({
      where: { workspaceId, deletedAt: null, rooms: { some: { roomId: { in: roomIds } } }, ...documentVisibility(actor) },
      include: { content: true }, orderBy: { updatedAt: 'desc' }, take: LIMITS.documents,
    })
    for (const d of docs) {
      const blocks = Array.isArray(d.content?.content) ? (d.content!.content as { text?: string }[]) : []
      pack.push({ id: `document:${d.id}`, kind: 'document', when: day(d.updatedAt), title: d.title, text: clip(blocks.map((b) => b.text ?? '').join(' '), LIMITS.text), link: { type: 'document', id: d.id } })
    }
  }

  // Bounded: drop the oldest timeline and message items first.
  let size = pack.reduce((n, e) => n + e.text.length + e.title.length, 0)
  for (let i = pack.length - 1; size > LIMITS.total && i > 0; i--) {
    if (pack[i]!.kind === 'activity' || pack[i]!.kind === 'message') { size -= pack[i]!.text.length + pack[i]!.title.length; pack.splice(i, 1) }
  }
  return { contactName: contact.displayName, pack }
}

// What the model gets (doc/13 §13): code picks the evidence, newest first per kind.
// Who they are always goes; then notes, messages, timeline and documents up to small
// per-kind caps, at most 20 items and about 3k tokens of text. The full pack stays
// the stale check and the AI-off template's source.
const MODEL = { note: 6, message: 5, activity: 6, document: 2, items: 20, chars: 12_000 } as const
export function selectForModel(pack: PackItem[]): PackItem[] {
  const out = pack.filter((e) => e.kind === 'contact' || e.kind === 'account')
  let chars = out.reduce((n, e) => n + e.text.length + e.title.length, 0)
  for (const kind of ['note', 'message', 'activity', 'document'] as const) {
    for (const e of pack.filter((x) => x.kind === kind).slice(0, MODEL[kind])) {
      const size = e.text.length + e.title.length
      if (out.length >= MODEL.items || chars + size > MODEL.chars) break
      out.push(e); chars += size
    }
  }
  return out
}

/** Changes whenever anything in the pack changes — the stale check. */
export const packHash = (pack: PackItem[]) => createHash('sha256').update(JSON.stringify(pack.map((e) => [e.id, e.when, e.title, e.text]))).digest('hex')

// ─── the AI-off brief: only what the records state ────────────────────────────────

export function templateBrief(pack: PackItem[]): Brief {
  const contact = pack.find((e) => e.kind === 'contact')!
  const field = (label: string) => contact.text.match(new RegExp(`${label}: ([^.]*)`))?.[1]?.trim() ?? ''
  const accounts = pack.filter((e) => e.kind === 'account')
  const notes = pack.filter((e) => e.kind === 'note')
  const c = (text: string, ...ids: string[]): Claim => ({ text, evidence: ids })

  const title = field('Title')
  const who = `${contact.title}${title && title !== 'not recorded' ? `, ${title}` : ''}${accounts.length ? ` at ${accounts.map((a) => a.title).join(', ')}` : ''}.`
  const summary = [c(who, contact.id, ...accounts.map((a) => a.id)), c(`Lead status: ${field('Lead status')}.`, contact.id)]
  // What notes were read as needing (D2 facts), quoted from the note.
  const need: Claim[] = []
  for (const n of notes) {
    const read = n.text.match(/\(read: ([^)]*)\)/)?.[1]
    for (const part of read?.split('; ') ?? []) {
      const [key, ...value] = part.split(': ')
      if (['need', 'budget', 'timing'].includes(key!)) need.push(c(`${key![0]!.toUpperCase()}${key!.slice(1)}: ${value.join(': ')}.`, n.id))
    }
  }
  const recent = pack.filter((e) => e.kind === 'note' || e.kind === 'activity' || e.kind === 'message').slice(0, 4)
    .map((e) => c(`${e.when ? `${e.when}: ` : ''}${clip(e.text.replace(/\s*\(read: [^)]*\)/, ''), 160)}`, e.id))
  const openQuestions: Claim[] = []
  if (field('Email') === 'none on file') openQuestions.push(c('No email on file.', contact.id))
  if (field('Phone') === 'none on file') openQuestions.push(c('No phone number on file.', contact.id))
  if (!accounts.length) openQuestions.push(c('No company recorded.', contact.id))
  if (!need.some((x) => x.text.startsWith('Budget'))) openQuestions.push(c('Budget not recorded.', contact.id, ...notes.map((n) => n.id)))
  const follow = field('Next follow-up')
  const nextStep = follow && follow !== 'not set' ? { text: `Follow up on ${follow}, as planned.`, basis: [contact.id] } : null
  return { summary, need, recent, commitments: [], openQuestions, nextStep }
}

// ─── the cache ────────────────────────────────────────────────────────────────

export type BriefView = Brief & {
  generatedAt: Date
  generator: 'ai' | 'template'
  model: string | null
  stale: boolean
  /** Only the evidence the brief cites, with where to open it. */
  evidence: PackItem[]
}

function viewOf(row: { brief: Prisma.JsonValue; evidence: Prisma.JsonValue; createdAt: Date; generator: string; model: string | null; packHash: string }, currentHash: string): BriefView {
  return { ...(row.brief as unknown as Brief), evidence: row.evidence as unknown as PackItem[], generatedAt: row.createdAt, generator: row.generator as 'ai' | 'template', model: row.model, stale: row.packHash !== currentHash }
}

export async function memberIdOf(userId: string, workspaceId: string) {
  return (await authorize(userId, workspaceId, 'record.read')).member.id
}

/** The viewer's last brief and whether it is stale, or null if they never asked. */
export async function cachedBrief(userId: string, workspaceId: string, contactId: string) {
  const memberId = await memberIdOf(userId, workspaceId)
  const { pack } = await buildPack(userId, workspaceId, contactId)
  const row = await db.contactBrief.findUnique({ where: { contactId_memberId: { contactId, memberId } } })
  return row ? viewOf(row, packHash(pack)) : null
}

/** Stores a brief with the evidence it cites and the hash of the pack it read. */
export async function storeBrief(userId: string, workspaceId: string, contactId: string, pack: PackItem[], brief: Brief, meta: { generator: 'ai' | 'template'; model: string | null; callId: string | null }) {
  const memberId = await memberIdOf(userId, workspaceId)
  const cited = new Set([...brief.summary, ...brief.need, ...brief.recent, ...brief.commitments, ...brief.openQuestions].flatMap((c) => c.evidence).concat(brief.nextStep?.basis ?? []))
  const evidence = pack.filter((e) => cited.has(e.id))
  const hash = packHash(pack)
  const data = { workspaceId, packHash: hash, brief: brief as unknown as Prisma.InputJsonValue, evidence: evidence as unknown as Prisma.InputJsonValue, generator: meta.generator, model: meta.model, callId: meta.callId, createdAt: new Date() }
  const row = await db.contactBrief.upsert({ where: { contactId_memberId: { contactId, memberId } }, create: { contactId, memberId, ...data }, update: data })
  return viewOf(row, hash)
}
