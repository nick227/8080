import { defaultContactStage } from './PipelineService'
// A messy business note → one proposed CRM change (doc/13 §10, D2). The model only
// reads the note (bots/assistant, grounded); this file matches against the
// workspace, plans the change, describes it, and applies or undoes it atomically.
//
//   read (AI, or a typed name when it's off) → match (contacts by email/name, accounts
//   by domain/name) → ambiguous? a choice : a plan → proposal `crm.note` → Apply:
//   one action, one transaction: account → contact → link → field changes → note.
import { db, type ContactPointKind, type Prisma } from '@project/db'
import { badRequest, conflict } from '../lib/errors'
import { matchAccountsByDomain, matchContactsByEmail, normalizePoint } from './contactMatch'
import { displayNameOf, preparePoints, writePoints } from './ContactService'
import { domainFields } from './AccountService'
import { runAction, subjectKey, type ActivityDraft, type SubjectRef } from './actions'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize } from './workspacePolicy'
import type { Grounded } from '../bots/assistant/grounding'

type Tx = Prisma.TransactionClient
export type NoteFact = { key: 'need' | 'timing' | 'budget' | 'other'; value: string; quote: string }
export type Candidate = { id: string; label: string }

/** The `crm.note` proposal payload: everything Apply will do, nothing it won't. */
export type NotePlan = {
  note: string
  reading: Grounded | null
  contact: { id: string; name: string } | { create: { firstName: string | null; lastName: string | null; displayName: string } }
  account: null | { id: string; name: string; link: boolean } | { create: { name: string; domain: string | null } }
  set: { title?: string; nextFollowUp?: string }
  addPoints: { kind: 'email' | 'phone'; value: string }[]
  facts: NoteFact[]
  quotes: Partial<Record<'name' | 'company' | 'title' | 'email' | 'phone' | 'followUp', string>>
}
export type Choice = { contactId?: string | 'new'; accountId?: string | 'new' | 'none' }
export type Planned = { plan: NotePlan } | { ambiguous: { contacts?: Candidate[]; accounts?: Candidate[] } }

const MAX_NOTE = 5000
const live = { deletedAt: null, mergedIntoId: null } satisfies Prisma.ContactWhereInput
const fullName = (r: Grounded) => [r.person.firstName, r.person.lastName].filter(Boolean).join(' ')

/** A typed name when the assistant is off: a reading with only the person. */
export function readingFromName(name: string): Grounded {
  const [firstName, ...rest] = name.trim().replace(/\s+/g, ' ').split(' ')
  return { person: { firstName: firstName || null, lastName: rest.join(' ') || null, title: null, email: null, phone: null }, company: { name: null, domain: null }, followUp: { date: null, quote: null }, facts: [], dropped: [] }
}

// ─── matching (rule 2: match before creating; rule 3: ambiguity is a choice) ──────

async function contactCandidates(workspaceId: string, r: Grounded) {
  if (r.person.email) {
    const m = await matchContactsByEmail(db, workspaceId, r.person.email)
    if (m.contactIds.length) return db.contact.findMany({ where: { id: { in: m.contactIds }, workspaceId, ...live }, include: { accounts: { include: { account: true } } } })
  }
  const name = fullName(r)
  if (!name) return []
  const or: Prisma.ContactWhereInput[] = [{ displayName: name }]
  if (r.person.firstName && r.person.lastName) or.push({ firstName: r.person.firstName, lastName: r.person.lastName })
  return db.contact.findMany({ where: { workspaceId, ...live, OR: or }, include: { accounts: { include: { account: true } } }, take: 6 })
}

async function accountCandidates(workspaceId: string, r: Grounded) {
  if (r.company.domain) {
    const m = await matchAccountsByDomain(db, workspaceId, r.company.domain)
    if (m.accountIds.length) return db.account.findMany({ where: { id: { in: m.accountIds }, workspaceId, deletedAt: null } })
  }
  if (!r.company.name) return []
  return db.account.findMany({ where: { workspaceId, deletedAt: null, name: r.company.name }, take: 6 })
}

const contactLabel = (c: { displayName: string; accounts: { account: { name: string } }[] }) =>
  c.accounts.length ? `${c.displayName} — ${c.accounts.map((a) => a.account.name).join(', ')}` : c.displayName

/** Matches and plans. Several candidates for the person or the company → ambiguous,
 *  until `choice` says which (or new). */
export async function planNote(workspaceId: string, note: string, reading: Grounded | null, choice: Choice = {}): Promise<Planned> {
  const text = note.trim()
  if (!text) throw badRequest('A note needs text', 'EMPTY_NOTE')
  if (text.length > MAX_NOTE) throw badRequest(`Keep a note under ${MAX_NOTE} characters`, 'NOTE_TOO_LONG')
  const r = reading ?? readingFromName('')
  const company = r.company.name

  // The company first: it narrows which person is meant.
  let accountPick: NotePlan['account'] | 'ambiguous' = null
  let accountIds: string[] = []
  if (choice.accountId === 'none') accountPick = null
  else if (choice.accountId && choice.accountId !== 'new') {
    const a = await db.account.findFirst({ where: { id: choice.accountId, workspaceId, deletedAt: null } })
    if (!a) throw badRequest('That company is no longer here', 'INVALID_CHOICE')
    accountPick = { id: a.id, name: a.name, link: true }
  } else if (company) {
    const found = choice.accountId === 'new' ? [] : await accountCandidates(workspaceId, r)
    accountIds = found.map((a) => a.id)
    accountPick = found.length === 1 ? { id: found[0]!.id, name: found[0]!.name, link: true }
      : found.length === 0 ? { create: { name: company, domain: r.company.domain } }
      : 'ambiguous'
  }

  let contact: NotePlan['contact'] | 'ambiguous'
  let existing: Awaited<ReturnType<typeof contactCandidates>>[number] | null = null
  let people: Awaited<ReturnType<typeof contactCandidates>> = []
  if (choice.contactId && choice.contactId !== 'new') {
    existing = await db.contact.findFirst({ where: { id: choice.contactId, workspaceId, ...live }, include: { accounts: { include: { account: true } } } })
    if (!existing) throw badRequest('That contact is no longer here', 'INVALID_CHOICE')
    contact = { id: existing.id, name: existing.displayName }
  } else {
    people = choice.contactId === 'new' ? [] : await contactCandidates(workspaceId, r)
    // A named company that one candidate already belongs to settles it.
    const atCompany = accountIds.length ? people.filter((p) => p.accounts.some((a) => accountIds.includes(a.accountId) && !a.endedAt)) : []
    const pick = people.length === 1 ? people[0]! : atCompany.length === 1 ? atCompany[0]! : null
    if (pick) { existing = pick; contact = { id: pick.id, name: pick.displayName } }
    else if (people.length > 1) contact = 'ambiguous'
    else {
      const name = fullName(r)
      if (!name && !r.person.email && !r.person.phone) throw badRequest('Who is this note about? Give a name.', 'NO_PERSON')
      const points = [r.person.email && { kind: 'email' as const, value: r.person.email, isPrimary: true }, r.person.phone && { kind: 'phone' as const, value: r.person.phone, isPrimary: true }].filter(Boolean) as { kind: ContactPointKind; value: string; isPrimary: boolean }[]
      contact = { create: { firstName: r.person.firstName, lastName: r.person.lastName, displayName: displayNameOf({ firstName: r.person.firstName, lastName: r.person.lastName }, points) } }
    }
  }
  if (contact === 'ambiguous' || accountPick === 'ambiguous') {
    return {
      ambiguous: {
        ...(contact === 'ambiguous' ? { contacts: people.map((p) => ({ id: p.id, label: contactLabel(p) })) } : {}),
        ...(accountPick === 'ambiguous' ? { accounts: (await db.account.findMany({ where: { id: { in: accountIds } } })).map((a) => ({ id: a.id, label: a.domain ? `${a.name} (${a.domain})` : a.name })) } : {}),
      },
    }
  }
  // Already linked to the company → nothing to link.
  let account = accountPick as NotePlan['account']
  if (account && 'id' in account) {
    const id = account.id
    if (existing?.accounts.some((a) => a.accountId === id && !a.endedAt)) account = { ...account, link: false }
  }
  // An existing contact with no company named keeps its own.

  // Field changes (rule 5: an existing contact's values become diffs, points only added).
  const set: NotePlan['set'] = {}
  if (r.person.title && r.person.title !== existing?.title) set.title = r.person.title
  if (r.followUp.date && r.followUp.date !== existing?.nextFollowUp?.toISOString().slice(0, 10)) set.nextFollowUp = r.followUp.date
  const have = new Set((existing ? await db.contactPoint.findMany({ where: { contactId: existing.id, live: true } }) : []).map((p) => `${p.kind}:${p.normalized}`))
  const addPoints: NotePlan['addPoints'] = []
  for (const [kind, value] of [['email', r.person.email], ['phone', r.person.phone]] as const) {
    if (value && !have.has(`${kind}:${normalizePoint(kind, value)}`)) addPoints.push({ kind, value })
  }
  const quotes: NotePlan['quotes'] = {}
  if (fullName(r)) quotes.name = fullName(r)
  if (company) quotes.company = company
  if (r.person.title) quotes.title = r.person.title
  if (r.person.email) quotes.email = r.person.email
  if (r.person.phone) quotes.phone = r.person.phone
  if (r.followUp.quote) quotes.followUp = r.followUp.quote
  return { plan: { note: text, reading, contact: contact as NotePlan['contact'], account, set, addPoints, facts: r.facts, quotes } }
}

// ─── description (rule 10: each row shows the note's own words) ──────────────────

export type PlanRow = { label: string; before: string; after: string; key?: string; value?: string; quote?: string }
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const FACT_LABEL: Record<NoteFact['key'], string> = { need: 'Need', timing: 'Timing', budget: 'Budget', other: 'Note fact' }

export async function describePlan(workspaceId: string, plan: NotePlan): Promise<{ title: string; diff: PlanRow[] }> {
  const rows: PlanRow[] = []
  const isNew = 'create' in plan.contact
  const current = isNew ? null : await db.contact.findFirst({ where: { id: (plan.contact as { id: string }).id, workspaceId } })
  const name = isNew ? (plan.contact as { create: { displayName: string } }).create.displayName : current?.displayName ?? (plan.contact as { name: string }).name
  if (isNew) rows.push({ label: 'Name', before: '', after: name, key: 'name', value: name, quote: plan.quotes.name })
  if (plan.account && ('create' in plan.account || plan.account.link)) {
    const created = 'create' in plan.account
    rows.push({ label: 'Company', before: '', after: created ? `${(plan.account as { create: { name: string } }).create.name} (new)` : (plan.account as { name: string }).name, ...(created ? { key: 'company', value: (plan.account as { create: { name: string } }).create.name } : {}), quote: plan.quotes.company })
  }
  if (plan.set.title !== undefined) rows.push({ label: 'Title', before: current?.title ?? '', after: plan.set.title, key: 'title', value: plan.set.title, quote: plan.quotes.title })
  for (const p of plan.addPoints) rows.push({ label: p.kind === 'email' ? 'Email' : 'Phone', before: '', after: p.value, key: p.kind, value: p.value, quote: plan.quotes[p.kind] })
  if (plan.set.nextFollowUp !== undefined) {
    rows.push({ label: 'Follow up', before: current?.nextFollowUp ? day(current.nextFollowUp.toISOString().slice(0, 10)) : '', after: day(plan.set.nextFollowUp), key: 'followUp', value: plan.set.nextFollowUp, quote: plan.quotes.followUp })
  }
  for (const f of plan.facts) rows.push({ label: FACT_LABEL[f.key], before: '', after: f.value, quote: f.quote })
  rows.push({ label: 'Note', before: '', after: plan.note.length > 240 ? `${plan.note.slice(0, 237)}…` : plan.note })
  return { title: isNew ? `Add ${name} to CRM` : `Update ${name}`, diff: rows }
}

/** Edit before Apply (doc/13 §10): name and company only for new records. */
export function editPlan(plan: NotePlan, edits: Record<string, unknown>): NotePlan {
  const next: NotePlan = JSON.parse(JSON.stringify(plan))
  const str = (k: string, max: number) => {
    const v = edits[k]
    if (v === undefined) return undefined
    if (typeof v !== 'string') throw badRequest(`${k} must be text`, 'INVALID_EDIT')
    const t = v.trim().replace(/\s+/g, ' ')
    if (t.length > max) throw badRequest(`${k} is too long`, 'INVALID_EDIT')
    return t
  }
  const name = str('name', 160)
  if (name !== undefined) {
    if (!('create' in next.contact)) throw badRequest('An existing contact keeps its name here', 'INVALID_EDIT')
    if (!name) throw badRequest('A contact needs a name', 'INVALID_EDIT')
    const [first, ...rest] = name.split(' ')
    next.contact.create = { firstName: first ?? null, lastName: rest.join(' ') || null, displayName: name }
  }
  const company = str('company', 160)
  if (company !== undefined) {
    if (next.account && !('create' in next.account)) throw badRequest('An existing company is chosen, not typed', 'INVALID_EDIT')
    next.account = company ? { create: { name: company, domain: next.account && 'create' in next.account ? next.account.create.domain : null } } : null
  }
  const title = str('title', 120)
  if (title !== undefined) { if (title) next.set.title = title; else delete next.set.title }
  for (const kind of ['email', 'phone'] as const) {
    const v = str(kind, kind === 'email' ? 254 : 40)
    if (v === undefined) continue
    next.addPoints = next.addPoints.filter((p) => p.kind !== kind)
    if (v) {
      if (!normalizePoint(kind, v)) throw badRequest(`That isn't a valid ${kind}`, 'INVALID_EDIT')
      next.addPoints.push({ kind, value: v })
    }
  }
  const followUp = str('followUp', 10)
  if (followUp !== undefined) {
    if (followUp && !/^\d{4}-\d{2}-\d{2}$/.test(followUp)) throw badRequest('Follow-up is a date like 2026-10-09', 'INVALID_EDIT')
    if (followUp) next.set.nextFollowUp = followUp; else delete next.set.nextFollowUp
  }
  return next
}

// ─── apply / undo (rule 8: one action, one transaction) ──────────────────────────

export type NoteUndo = {
  contactId: string
  createdContact: boolean
  accountId: string | null
  createdAccount: boolean
  linkId: string | null
  noteId: string
  before: { title: string | null; nextFollowUp: string | null; points: { kind: ContactPointKind; value: string; label: string | null; isPrimary: boolean; shared: boolean }[] } | null
}

export async function applyPlan(ctx: WorkspaceCtx, workspaceId: string, plan: NotePlan, baseVersion: number) {
  const actor = await authorize(ctx.user.id, workspaceId, 'record.write')
  const memberId = actor.member.id
  return runAction(
    { action: 'crm.note.apply', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { contact: 'create' in plan.contact ? 'new' : plan.contact.id, account: plan.account ? ('create' in plan.account ? 'new' : plan.account.id) : null, fields: Object.keys(plan.set), points: plan.addPoints.length, facts: plan.facts.length }, target: { type: 'contact' } },
    async (tx) => {
      const subjects: SubjectRef[] = []
      const activities: ActivityDraft[] = []

      // The company.
      let accountId: string | null = null
      let createdAccount = false
      if (plan.account && 'create' in plan.account) {
        const a = await tx.account.create({ data: { workspaceId, name: plan.account.create.name, ...domainFields(plan.account.create.domain), origin: 'conversation', createdById: memberId } })
        accountId = a.id
        createdAccount = true
        activities.push({ type: 'account.created', summary: { accountId: a.id, name: a.name }, subjects: [{ accountId: a.id }] })
      } else if (plan.account) {
        const a = await tx.account.findFirst({ where: { id: plan.account.id, workspaceId, deletedAt: null } })
        if (!a) throw conflict('That company is gone', 'STALE')
        accountId = a.id
      }

      // The person.
      let contactId: string
      let createdContact = false
      let before: NoteUndo['before'] = null
      if ('create' in plan.contact) {
        // Rule 2 at apply time: the person must still not exist.
        for (const p of plan.addPoints.filter((x) => x.kind === 'email')) {
          if ((await matchContactsByEmail(tx, workspaceId, p.value)).contactIds.length) throw conflict('Someone with this email was added since', 'STALE')
        }
        const points = preparePoints(plan.addPoints.map((p) => ({ kind: p.kind, value: p.value, isPrimary: true })))
        const c = await tx.contact.create({
          data: {
        leadStatus: await defaultContactStage(tx, workspaceId),
            workspaceId, firstName: plan.contact.create.firstName, lastName: plan.contact.create.lastName,
            displayName: plan.contact.create.displayName, title: plan.set.title ?? null,
            nextFollowUp: plan.set.nextFollowUp ? new Date(`${plan.set.nextFollowUp}T12:00:00Z`) : null,
            origin: 'conversation', createdById: memberId,
          },
        })
        if (points.length) await writePoints(tx, workspaceId, c.id, points)
        contactId = c.id
        createdContact = true
        activities.push({ type: 'contact.created', summary: { contactId: c.id, name: c.displayName }, subjects: [{ contactId: c.id }, ...(accountId ? [{ accountId }] : [])] })
      } else {
        const claimed = await tx.contact.updateMany({ where: { id: plan.contact.id, workspaceId, ...live, version: baseVersion }, data: { version: { increment: 1 } } })
        if (!claimed.count) throw conflict('The contact changed since this was proposed', 'STALE')
        const c = await tx.contact.findUniqueOrThrow({ where: { id: plan.contact.id }, include: { points: { where: { live: true }, orderBy: { position: 'asc' } } } })
        before = {
          title: c.title, nextFollowUp: c.nextFollowUp?.toISOString().slice(0, 10) ?? null,
          points: c.points.map((p) => ({ kind: p.kind, value: p.value, label: p.label, isPrimary: p.isPrimary, shared: p.shared })),
        }
        const changes = { ...(plan.set.title !== undefined ? { title: plan.set.title } : {}), ...(plan.set.nextFollowUp !== undefined ? { nextFollowUp: new Date(`${plan.set.nextFollowUp}T12:00:00Z`) } : {}) }
        if (Object.keys(changes).length) await tx.contact.update({ where: { id: c.id }, data: changes })
        if (plan.addPoints.length) {
          await writePoints(tx, workspaceId, c.id, preparePoints([...before.points, ...plan.addPoints.map((p) => ({ kind: p.kind, value: p.value, isPrimary: false }))]))
        }
        contactId = c.id
        if (Object.keys(changes).length || plan.addPoints.length) activities.push({ type: 'contact.updated', summary: { contactId, fields: [...Object.keys(changes), ...plan.addPoints.map((p) => p.kind)] }, subjects: [{ contactId }] })
      }
      subjects.push({ contactId })

      // The link (primary if the person has none).
      let linkId: string | null = null
      if (accountId && (createdAccount || (plan.account && 'id' in plan.account && plan.account.link))) {
        const existingLink = await tx.contactAccount.findFirst({ where: { workspaceId, contactId, accountId, endedAt: null } })
        if (!existingLink) {
          const hasPrimary = await tx.contactAccount.count({ where: { contactId, isPrimary: true, endedAt: null } })
          linkId = (await tx.contactAccount.create({ data: { workspaceId, contactId, accountId, isPrimary: hasPrimary === 0 } })).id
        }
      }
      if (accountId) subjects.push({ accountId })

      // The note, verbatim (rule 1), with what was read from it.
      const message = await tx.message.create({ data: { authorId: ctx.user.id, text: plan.note } })
      const note = await tx.note.create({ data: { workspaceId, messageId: message.id, authorMemberId: memberId, facts: plan.facts.length ? (plan.facts as Prisma.InputJsonValue) : undefined } })
      await tx.recordLink.createMany({ data: subjects.map((s) => ({ workspaceId, ...s, noteId: note.id, pairKey: `${subjectKey(s)}|note:${note.id}`, how: 'manual' as const, linkedById: memberId })) })
      activities.push({ type: 'note.added', summary: { noteId: note.id, excerpt: plan.note.slice(0, 140), media: 0 }, subjects, object: { noteId: note.id } })

      const resultVersion = (await tx.contact.findUniqueOrThrow({ where: { id: contactId }, select: { version: true } })).version
      const undo: NoteUndo = { contactId, createdContact, accountId, createdAccount, linkId, noteId: note.id, before }
      return { value: { contactId, resultVersion, undo }, targetId: contactId, activities }
    },
  )
}

/** Reverses an applied note — only while the contact is still at `resultVersion`. */
export async function undoPlan(ctx: WorkspaceCtx, workspaceId: string, undo: NoteUndo, resultVersion: number) {
  const actor = await authorize(ctx.user.id, workspaceId, 'record.write')
  await runAction(
    { action: 'crm.note.undo', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { contactId: undo.contactId, noteId: undo.noteId }, target: { type: 'contact', id: undo.contactId } },
    async (tx) => {
      const claimed = await tx.contact.updateMany({ where: { id: undo.contactId, workspaceId, version: resultVersion }, data: { version: { increment: 1 } } })
      if (!claimed.count) throw conflict('The contact changed since; this can no longer be undone', 'STALE')
      await tx.note.update({ where: { id: undo.noteId }, data: { deletedAt: new Date() } })
      await tx.activitySubject.deleteMany({ where: { activity: { noteId: undo.noteId } } })
      if (undo.linkId) await tx.contactAccount.deleteMany({ where: { id: undo.linkId, workspaceId } })
      if (undo.createdContact) {
        await tx.contact.update({ where: { id: undo.contactId }, data: { deletedAt: new Date() } })
        await tx.contactPoint.updateMany({ where: { contactId: undo.contactId }, data: { live: false } })
      } else if (undo.before) {
        await tx.contact.update({ where: { id: undo.contactId }, data: { title: undo.before.title, nextFollowUp: undo.before.nextFollowUp ? new Date(`${undo.before.nextFollowUp}T12:00:00Z`) : null } })
        await writePoints(tx, workspaceId, undo.contactId, preparePoints(undo.before.points))
      }
      // A company made by this note goes too — unless something else uses it now.
      if (undo.createdAccount && undo.accountId) {
        const others = await tx.contactAccount.count({ where: { accountId: undo.accountId } }) + await tx.recordLink.count({ where: { accountId: undo.accountId, noteId: { not: undo.noteId } } })
        if (!others) await tx.account.update({ where: { id: undo.accountId }, data: { deletedAt: new Date() } })
      }
      return { value: null, targetId: undo.contactId }
    },
  )
}
