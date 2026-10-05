// Contacts (doc/09 §4.1). Email is a match signal, never a unique key (D2):
// create never refuses a duplicate — it reports possible ones — and duplicates
// are resolved by merge. Every mutation is a runAction (audit + timeline).
import { db, Prisma, type ContactPointKind, type RecordStatus } from '@project/db'
import { badRequest, notFound } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { contactInclude, toAccountRef, toContact, toContactRef, type ContactRow } from '../lib/serialize'
import { diff, runAction, subjectKey, type SubjectRef } from './actions'
import { emailDomain, isRoleAddress, matchAccountsByDomain, matchContactsByEmail, normalizeEmail, normalizePoint } from './contactMatch'
import { assertAssignees, assertTags, liveAccount, liveContact, replaceTags, timeline } from './records'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize, permit } from './workspacePolicy'

type Tx = Prisma.TransactionClient

export type PointInput = { kind: ContactPointKind; value: string; label?: string | null; isPrimary?: boolean; shared?: boolean }
export type ContactInput = {
  firstName?: string | null
  lastName?: string | null
  displayName?: string | null
  title?: string | null
  status?: RecordStatus
  ownerMemberId?: string | null
  teamId?: string | null
  points?: PointInput[]
  tagIds?: string[]
  externalProvider?: string | null
  externalId?: string | null
}
export type ContactAccountInput = { role?: string | null; isPrimary?: boolean; startedAt?: string | null; endedAt?: string | null }

const MAX_POINTS = 20
const blank = (s: string | null | undefined) => (s?.trim() ? s.trim() : null)

// Normalise, drop repeats (same kind + normalized value), pick one primary per kind.
// Role addresses (info@…) are shared unless the caller says otherwise.
function preparePoints(points: PointInput[]) {
  if (points.length > MAX_POINTS) throw badRequest(`At most ${MAX_POINTS} contact points`, 'TOO_MANY_POINTS')
  const seen = new Set<string>()
  const prepared = []
  for (const p of points) {
    const value = p.value.trim()
    if (!value) continue
    const normalized = normalizePoint(p.kind, value)
    if (!normalized || seen.has(`${p.kind}:${normalized}`)) continue
    seen.add(`${p.kind}:${normalized}`)
    prepared.push({ kind: p.kind, value, normalized, label: blank(p.label), isPrimary: p.isPrimary === true, shared: p.shared ?? (p.kind === 'email' && isRoleAddress(normalized)) })
  }
  for (const kind of new Set(prepared.map((p) => p.kind))) {
    const ofKind = prepared.filter((p) => p.kind === kind)
    const primary = ofKind.find((p) => p.isPrimary) ?? ofKind[0]!
    for (const p of ofKind) p.isPrimary = p === primary
  }
  return prepared.map((p, position) => ({ ...p, position }))
}

const primaryOf = (points: { kind: ContactPointKind; value: string; isPrimary: boolean }[], kind: ContactPointKind) =>
  points.find((p) => p.kind === kind && p.isPrimary)?.value ?? null

function displayNameOf(input: { displayName?: string | null; firstName?: string | null; lastName?: string | null }, points: { kind: ContactPointKind; value: string; isPrimary: boolean }[]) {
  const name = blank(input.displayName) ?? blank([blank(input.firstName), blank(input.lastName)].filter(Boolean).join(' ')) ?? primaryOf(points, 'email') ?? primaryOf(points, 'phone')
  if (!name) throw badRequest('A contact needs a name, an email or a phone number', 'EMPTY_CONTACT')
  return name.slice(0, 160)
}

const pointsSnapshot = (points: { kind: string; value: string }[]) => points.map((p) => `${p.kind}:${p.value}`)

async function loadContact(client: Tx | typeof db, contactId: string) {
  return client.contact.findUniqueOrThrow({ where: { id: contactId }, include: contactInclude })
}

// Replaces a contact's points and refreshes the derived primaries.
async function writePoints(tx: Tx, workspaceId: string, contactId: string, points: ReturnType<typeof preparePoints>) {
  await tx.contactPoint.deleteMany({ where: { contactId } })
  if (points.length) await tx.contactPoint.createMany({ data: points.map((p) => ({ ...p, workspaceId, contactId })) })
  await tx.contact.update({ where: { id: contactId }, data: { primaryEmail: primaryOf(points, 'email'), primaryPhone: primaryOf(points, 'phone') } })
}

// Only one live primary account per contact.
async function settlePrimary(tx: Tx, contactId: string, primaryAccountId: string) {
  await tx.contactAccount.updateMany({ where: { contactId, accountId: { not: primaryAccountId }, isPrimary: true }, data: { isPrimary: false } })
}

export class ContactService {
  async list(userId: string, workspaceId: string, opts: { q?: string; ownerMemberId?: string; tagId?: string; accountId?: string; status?: RecordStatus; cursor?: string; limit?: number }) {
    await authorize(userId, workspaceId, 'record.read')
    const limit = normalizeLimit(opts.limit)
    const cursor = decodeKeyCursor<{ n: string; id: string }>(opts.cursor)
    const q = opts.q?.trim()
    const where: Prisma.ContactWhereInput = {
      workspaceId,
      deletedAt: null,
      status: opts.status ?? 'active',
      ...(opts.ownerMemberId ? { ownerMemberId: opts.ownerMemberId } : {}),
      ...(opts.tagId ? { tags: { some: { tagId: opts.tagId } } } : {}),
      ...(opts.accountId ? { accounts: { some: { accountId: opts.accountId, endedAt: null } } } : {}),
      ...(q ? { OR: [{ displayName: { contains: q } }, { points: { some: { normalized: { startsWith: q.toLowerCase() } } } }] } : {}),
    }
    if (cursor) {
      if (typeof cursor.n !== 'string' || typeof cursor.id !== 'string') throw badRequest('Invalid cursor')
      where.AND = [{ OR: [{ displayName: { gt: cursor.n } }, { displayName: cursor.n, id: { gt: cursor.id } }] }]
    }
    const rows = await db.contact.findMany({ where, include: contactInclude, orderBy: [{ displayName: 'asc' }, { id: 'asc' }], take: limit + 1 })
    const result = page(rows, limit, (last) => encodeKeyCursor({ n: last.displayName, id: last.id }))
    return { data: result.data.map(toContact), meta: result.meta }
  }

  // A merged contact resolves to the contact it was merged into (old links keep working).
  async get(userId: string, workspaceId: string, contactId: string) {
    await authorize(userId, workspaceId, 'record.read')
    let contact = await db.contact.findFirst({ where: { id: contactId, workspaceId }, include: contactInclude })
    for (let hops = 0; contact?.deletedAt && contact.mergedIntoId && hops < 10; hops++) {
      contact = await db.contact.findFirst({ where: { id: contact.mergedIntoId, workspaceId }, include: contactInclude })
    }
    if (!contact || contact.deletedAt) throw notFound('Contact not found')
    return toContact(contact)
  }

  async create(ctx: WorkspaceCtx, workspaceId: string, input: ContactInput & { accounts?: { accountId: string; role?: string | null; isPrimary?: boolean }[] }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.write')
    const points = preparePoints(input.points ?? [])
    const displayName = displayNameOf(input, points)
    await assertAssignees(workspaceId, input)
    await assertTags(workspaceId, input.tagIds)
    const accounts = input.accounts ?? []
    for (const a of accounts) await liveAccount(db, workspaceId, a.accountId)

    const contact = await runAction(
      { action: 'contact.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'contact' } },
      async (tx) => {
        const created = await tx.contact.create({
          data: {
            workspaceId,
            firstName: blank(input.firstName),
            lastName: blank(input.lastName),
            displayName,
            title: blank(input.title),
            status: input.status,
            ownerMemberId: input.ownerMemberId ?? null,
            teamId: input.teamId ?? null,
            origin: ctx.origin === 'ui' ? 'manual' : 'api',
            externalProvider: blank(input.externalProvider),
            externalId: blank(input.externalId),
            createdById: actor.member.id,
          },
        })
        await writePoints(tx, workspaceId, created.id, points)
        if (input.tagIds) await replaceTags(tx, 'contact', workspaceId, created.id, input.tagIds)
        const primary = accounts.find((a) => a.isPrimary) ?? accounts[0]
        for (const a of new Map(accounts.map((a) => [a.accountId, a])).values()) {
          await tx.contactAccount.create({ data: { workspaceId, contactId: created.id, accountId: a.accountId, role: blank(a.role), isPrimary: a === primary } })
        }
        const subjects: SubjectRef[] = [{ contactId: created.id }, ...accounts.map((a) => ({ accountId: a.accountId }))]
        return {
          value: await loadContact(tx, created.id),
          targetId: created.id,
          activities: [{ type: 'contact.created', summary: { contactId: created.id, name: displayName }, subjects }],
        }
      },
    )
    return { data: toContact(contact), duplicates: await this.duplicatesOf(contact) }
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, contactId: string, input: ContactInput) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.write')
    const before = await db.contact.findFirst({ where: { id: contactId, workspaceId, deletedAt: null }, include: contactInclude })
    if (!before) throw notFound('Contact not found')
    const points = input.points ? preparePoints(input.points) : null
    // An explicit name wins; clearing it or changing first/last re-derives it.
    const rederive = 'displayName' in input || 'firstName' in input || 'lastName' in input
    const displayName = rederive
      ? displayNameOf(
          {
            displayName: input.displayName,
            firstName: 'firstName' in input ? input.firstName : before.firstName,
            lastName: 'lastName' in input ? input.lastName : before.lastName,
          },
          points ?? before.points,
        )
      : before.displayName
    await assertAssignees(workspaceId, input)
    await assertTags(workspaceId, input.tagIds)

    return runAction(
      { action: 'contact.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'contact', id: contactId } },
      async (tx) => {
        await tx.contact.update({
          where: { id: contactId },
          data: {
            firstName: 'firstName' in input ? blank(input.firstName) : undefined,
            lastName: 'lastName' in input ? blank(input.lastName) : undefined,
            displayName,
            title: 'title' in input ? blank(input.title) : undefined,
            status: input.status,
            ownerMemberId: input.ownerMemberId,
            teamId: input.teamId,
            externalProvider: 'externalProvider' in input ? blank(input.externalProvider) : undefined,
            externalId: 'externalId' in input ? blank(input.externalId) : undefined,
          },
        })
        if (points) await writePoints(tx, workspaceId, contactId, points)
        if (input.tagIds) await replaceTags(tx, 'contact', workspaceId, contactId, input.tagIds)
        const after = await loadContact(tx, contactId)
        const changes = diff(before, after, ['firstName', 'lastName', 'displayName', 'title', 'status', 'ownerMemberId', 'teamId', 'externalProvider', 'externalId'])
        if (points) {
          const [a, b] = [pointsSnapshot(before.points), pointsSnapshot(after.points)]
          if (a.join('\n') !== b.join('\n')) changes.points = [a, b]
        }
        const subjects = [{ contactId }]
        const activities = []
        if (changes.ownerMemberId) activities.push({ type: 'owner.changed', summary: { contactId, name: after.displayName, from: before.ownerMemberId, to: after.ownerMemberId }, subjects })
        if (changes.status) activities.push({ type: after.status === 'archived' ? 'contact.archived' : 'contact.restored', summary: { contactId, name: after.displayName }, subjects })
        const value = toContact(after)
        return { value, result: { response: value }, changes, activities }
      },
      async previous => (previous.result as any).response,
    )
  }

  // Soft delete. Its email points stop matching; links and history stay.
  async remove(ctx: WorkspaceCtx, workspaceId: string, contactId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.read')
    const contact = await liveContact(db, workspaceId, contactId)
    permit(actor, 'record.delete', { kind: 'record', ownerMemberId: contact.ownerMemberId })
    await runAction(
      { action: 'contact.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'contact', id: contactId } },
      async (tx) => {
        await tx.contact.update({ where: { id: contactId }, data: { deletedAt: new Date() } })
        await tx.contactPoint.updateMany({ where: { contactId }, data: { live: false } })
        return { value: null }
      },
    )
  }

  // ─── matching and duplicates ───────────────────────────────────────────────

  /** What the matcher concludes for an email, plus the account its domain points at. */
  async match(userId: string, workspaceId: string, email: string) {
    await authorize(userId, workspaceId, 'record.read')
    const contacts = await matchContactsByEmail(db, workspaceId, email)
    const accounts = await matchAccountsByDomain(db, workspaceId, emailDomain(email))
    const [contactRows, accountRows] = await Promise.all([
      db.contact.findMany({ where: { id: { in: contacts.contactIds } }, orderBy: { displayName: 'asc' } }),
      db.account.findMany({ where: { id: { in: accounts.accountIds } }, orderBy: { name: 'asc' } }),
    ])
    return {
      email: normalizeEmail(email),
      result: contacts.result,
      matchId: contacts.matchId,
      contacts: contactRows.map(toContactRef),
      account: { result: accounts.result, matchId: accounts.matchId, accounts: accountRows.map(toAccountRef) },
    }
  }

  async duplicates(userId: string, workspaceId: string, contactId: string) {
    await authorize(userId, workspaceId, 'record.read')
    const contact = await db.contact.findFirst({ where: { id: contactId, workspaceId, deletedAt: null }, include: contactInclude })
    if (!contact) throw notFound('Contact not found')
    return this.duplicatesOf(contact)
  }

  // Possible duplicates: another live contact with the same personal email, or the
  // same name at the same (current) account. Never blocks anything.
  private async duplicatesOf(contact: ContactRow) {
    const emails = contact.points.filter((p) => p.kind === 'email' && !p.shared).map((p) => p.normalized)
    const accountIds = contact.accounts.filter((a) => !a.endedAt).map((a) => a.accountId)
    const or: Prisma.ContactWhereInput[] = []
    if (emails.length) or.push({ points: { some: { kind: 'email', normalized: { in: emails }, shared: false, live: true } } })
    if (accountIds.length) or.push({ displayName: contact.displayName, accounts: { some: { accountId: { in: accountIds }, endedAt: null } } })
    if (!or.length) return []
    const rows = await db.contact.findMany({
      where: { workspaceId: contact.workspaceId, deletedAt: null, id: { not: contact.id }, OR: or },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: 20,
    })
    return rows.map(toContactRef)
  }

  // ─── merge ─────────────────────────────────────────────────────────────────

  // `contactId` survives; `mergeContactId` is folded into it and soft-deleted with
  // mergedIntoId set. Every reference moves (points, accounts, tags, links,
  // timeline subjects), deduplicated. Merging away a record needs record.delete on it.
  async merge(ctx: WorkspaceCtx, workspaceId: string, contactId: string, mergeContactId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.write')
    if (contactId === mergeContactId) throw badRequest('Cannot merge a contact into itself', 'SAME_CONTACT')
    const winner = await liveContact(db, workspaceId, contactId)
    const loser = await liveContact(db, workspaceId, mergeContactId)
    permit(actor, 'record.delete', { kind: 'record', ownerMemberId: loser.ownerMemberId })

    return runAction(
      { action: 'contact.merge', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { mergeContactId }, target: { type: 'contact', id: contactId } },
      async (tx) => {
        const from = `contact:${loser.id}`
        const into = `contact:${winner.id}`

        // Points: the winner's primaries stay primary; repeats are dropped.
        const kept = await tx.contactPoint.findMany({ where: { contactId: winner.id } })
        const keptKeys = new Set(kept.map((p) => `${p.kind}:${p.normalized}`))
        let position = kept.length
        for (const p of await tx.contactPoint.findMany({ where: { contactId: loser.id }, orderBy: { position: 'asc' } })) {
          if (keptKeys.has(`${p.kind}:${p.normalized}`)) await tx.contactPoint.delete({ where: { id: p.id } })
          else {
            const firstOfKind = !kept.some((k) => k.kind === p.kind)
            await tx.contactPoint.update({ where: { id: p.id }, data: { contactId: winner.id, position: position++, isPrimary: firstOfKind && p.isPrimary } })
            keptKeys.add(`${p.kind}:${p.normalized}`)
          }
        }
        const points = await tx.contactPoint.findMany({ where: { contactId: winner.id } })
        await tx.contact.update({ where: { id: winner.id }, data: { primaryEmail: primaryOf(points, 'email'), primaryPhone: primaryOf(points, 'phone') } })

        // Accounts: keep the winner's row where both have one; one primary.
        const winnerAccounts = new Set((await tx.contactAccount.findMany({ where: { contactId: winner.id } })).map((ca) => ca.accountId))
        const winnerHasPrimary = await tx.contactAccount.count({ where: { contactId: winner.id, isPrimary: true } })
        for (const ca of await tx.contactAccount.findMany({ where: { contactId: loser.id } })) {
          if (winnerAccounts.has(ca.accountId)) await tx.contactAccount.delete({ where: { id: ca.id } })
          else await tx.contactAccount.update({ where: { id: ca.id }, data: { contactId: winner.id, isPrimary: winnerHasPrimary ? false : ca.isPrimary } })
        }

        // Tags.
        const tags = await tx.contactTag.findMany({ where: { contactId: loser.id } })
        await tx.contactTag.createMany({ data: tags.map((t) => ({ tagId: t.tagId, contactId: winner.id, workspaceId })), skipDuplicates: true })
        await tx.contactTag.deleteMany({ where: { contactId: loser.id } })

        // Links (pairKey carries the subject).
        for (const link of await tx.recordLink.findMany({ where: { contactId: loser.id } })) {
          const pairKey = link.pairKey.replace(from, into)
          const clash = await tx.recordLink.findUnique({ where: { workspaceId_pairKey: { workspaceId, pairKey } } })
          if (clash) await tx.recordLink.delete({ where: { id: link.id } })
          else await tx.recordLink.update({ where: { id: link.id }, data: { contactId: winner.id, pairKey } })
        }

        // Timeline subjects.
        const winnerActivities = new Set((await tx.activitySubject.findMany({ where: { contactId: winner.id }, select: { activityId: true } })).map((s) => s.activityId))
        for (const s of await tx.activitySubject.findMany({ where: { contactId: loser.id } })) {
          if (winnerActivities.has(s.activityId)) await tx.activitySubject.delete({ where: { id: s.id } })
          else await tx.activitySubject.update({ where: { id: s.id }, data: { contactId: winner.id, subjectKey: into } })
        }

        // Earlier merges into the loser now resolve straight to the winner.
        await tx.contact.updateMany({ where: { mergedIntoId: loser.id }, data: { mergedIntoId: winner.id } })
        await tx.contact.update({ where: { id: loser.id }, data: { mergedIntoId: winner.id, deletedAt: new Date() } })
        const newest = [winner.lastActivityAt, loser.lastActivityAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0]
        if (newest) await tx.contact.update({ where: { id: winner.id }, data: { lastActivityAt: newest } })

        const after = await loadContact(tx, winner.id)
        return {
          value: toContact(after),
          result: { mergedContactId: loser.id },
          activities: [{ type: 'contact.merged', summary: { contactId: winner.id, name: after.displayName, mergedName: loser.displayName }, subjects: [{ contactId: winner.id }] }],
        }
      },
    )
  }

  // ─── accounts of a contact ─────────────────────────────────────────────────

  async setAccount(ctx: WorkspaceCtx, workspaceId: string, contactId: string, accountId: string, input: ContactAccountInput) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.write')
    const contact = await liveContact(db, workspaceId, contactId)
    const account = await liveAccount(db, workspaceId, accountId)
    const existing = await db.contactAccount.findUnique({ where: { contactId_accountId: { contactId, accountId } } })
    const date = (s: string | null | undefined) => (s === undefined ? undefined : s === null ? null : new Date(s))

    return runAction(
      { action: 'contact.account.set', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { accountId, ...input }, target: { type: 'contact', id: contactId } },
      async (tx) => {
        const anyPrimary = await tx.contactAccount.count({ where: { contactId, isPrimary: true, accountId: { not: accountId } } })
        const data = { role: 'role' in input ? blank(input.role) : undefined, isPrimary: input.isPrimary, startedAt: date(input.startedAt), endedAt: date(input.endedAt) }
        const row = existing
          ? await tx.contactAccount.update({ where: { id: existing.id }, data })
          : await tx.contactAccount.create({ data: { workspaceId, contactId, accountId, ...data, isPrimary: input.isPrimary ?? anyPrimary === 0 } })
        if (row.isPrimary) await settlePrimary(tx, contactId, accountId)
        const subjects: SubjectRef[] = [{ contactId }, { accountId }]
        const summary = { contactId, name: contact.displayName, accountId, account: account.name }
        const activities = []
        if (!existing) activities.push({ type: 'contact.account_added', summary: { ...summary, role: row.role }, subjects })
        else if (!existing.endedAt && row.endedAt) activities.push({ type: 'contact.account_ended', summary, subjects })
        return {
          value: toContact(await loadContact(tx, contactId)),
          changes: existing ? diff(existing, row, ['role', 'isPrimary', 'startedAt', 'endedAt']) : undefined,
          activities,
        }
      },
    )
  }

  async removeAccount(ctx: WorkspaceCtx, workspaceId: string, contactId: string, accountId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.write')
    const contact = await liveContact(db, workspaceId, contactId)
    const existing = await db.contactAccount.findFirst({ where: { contactId, accountId, workspaceId }, include: { account: true } })
    if (!existing) throw notFound('Not linked to that account')
    return runAction(
      { action: 'contact.account.remove', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { accountId }, target: { type: 'contact', id: contactId } },
      async (tx) => {
        await tx.contactAccount.delete({ where: { id: existing.id } })
        return {
          value: toContact(await loadContact(tx, contactId)),
          activities: [{ type: 'contact.account_removed', summary: { contactId, name: contact.displayName, accountId, account: existing.account.name }, subjects: [{ contactId }, { accountId }] }],
        }
      },
    )
  }

  async timeline(userId: string, workspaceId: string, contactId: string, opts: { cursor?: string; limit?: number }) {
    await authorize(userId, workspaceId, 'record.read')
    await liveContact(db, workspaceId, contactId)
    return timeline(userId, workspaceId, { subjectKey: subjectKey({ contactId }), contactId }, opts)
  }
}
