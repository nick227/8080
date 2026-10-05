// Accounts / companies (doc/09 §4.1). Domain is a match signal, not unique:
// create reports accounts with the same domain instead of refusing (D2).
import { db, Prisma, type AccountType, type RecordStatus } from '@project/db'
import { badRequest, notFound } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { accountInclude, toAccount, toAccountRef } from '../lib/serialize'
import { diff, runAction, subjectKey } from './actions'
import { isFreeMailDomain, normalizeDomain } from './contactMatch'
import { assertAssignees, assertTags, liveAccount, replaceTags, timeline } from './records'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize, permit } from './workspacePolicy'

export type AccountInput = {
  name?: string
  domain?: string | null
  website?: string | null
  industry?: string | null
  sizeBand?: string | null
  type?: AccountType
  status?: RecordStatus
  parentAccountId?: string | null
  ownerMemberId?: string | null
  teamId?: string | null
  tagIds?: string[]
  externalProvider?: string | null
  externalId?: string | null
}

const blank = (s: string | null | undefined) => (s?.trim() ? s.trim() : null)

// A domain is stored as given; its normalised key is what matching uses.
// Personal mailbox domains (gmail.com…) never identify an organisation.
function domainFields(domain: string | null | undefined) {
  if (domain === undefined) return {}
  const value = blank(domain)
  if (!value) return { domain: null, domainKey: null }
  const key = normalizeDomain(value)
  if (!key) throw badRequest(`"${value}" is not a domain`, 'INVALID_DOMAIN')
  if (isFreeMailDomain(key)) throw badRequest(`${key} is a personal email provider, not a company domain`, 'FREE_MAIL_DOMAIN')
  return { domain: value, domainKey: key }
}

// The parent must be a live account of this workspace and not a descendant.
async function assertParent(workspaceId: string, accountId: string | null, parentAccountId: string | null | undefined) {
  if (!parentAccountId) return
  let cursor: string | null = parentAccountId
  for (let depth = 0; cursor && depth < 20; depth++) {
    if (cursor === accountId) throw badRequest('An account cannot be its own ancestor', 'INVALID_PARENT')
    const row: { parentAccountId: string | null } | null = await db.account.findFirst({ where: { id: cursor, workspaceId, deletedAt: null }, select: { parentAccountId: true } })
    if (!row) throw badRequest('Parent account not found in this workspace', 'INVALID_PARENT')
    cursor = row.parentAccountId
  }
}

const load = (client: Prisma.TransactionClient | typeof db, id: string) => client.account.findUniqueOrThrow({ where: { id }, include: accountInclude })

export class AccountService {
  async list(userId: string, workspaceId: string, opts: { q?: string; ownerMemberId?: string; tagId?: string; type?: AccountType; status?: RecordStatus; cursor?: string; limit?: number }) {
    await authorize(userId, workspaceId, 'record.read')
    const limit = normalizeLimit(opts.limit)
    const cursor = decodeKeyCursor<{ n: string; id: string }>(opts.cursor)
    const q = opts.q?.trim()
    const where: Prisma.AccountWhereInput = {
      workspaceId,
      deletedAt: null,
      status: opts.status ?? 'active',
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.ownerMemberId ? { ownerMemberId: opts.ownerMemberId } : {}),
      ...(opts.tagId ? { tags: { some: { tagId: opts.tagId } } } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { domainKey: { startsWith: q.toLowerCase() } }] } : {}),
    }
    if (cursor) {
      if (typeof cursor.n !== 'string' || typeof cursor.id !== 'string') throw badRequest('Invalid cursor')
      where.AND = [{ OR: [{ name: { gt: cursor.n } }, { name: cursor.n, id: { gt: cursor.id } }] }]
    }
    const rows = await db.account.findMany({ where, include: accountInclude, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: limit + 1 })
    const result = page(rows, limit, (last) => encodeKeyCursor({ n: last.name, id: last.id }))
    return { data: result.data.map(toAccount), meta: result.meta }
  }

  async get(userId: string, workspaceId: string, accountId: string) {
    await authorize(userId, workspaceId, 'record.read')
    await liveAccount(db, workspaceId, accountId)
    return toAccount(await load(db, accountId))
  }

  async create(ctx: WorkspaceCtx, workspaceId: string, input: AccountInput & { name: string }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.write')
    const name = blank(input.name)
    if (!name) throw badRequest('Name is required', 'INVALID_NAME')
    const domain = domainFields(input.domain)
    await assertAssignees(workspaceId, input)
    await assertTags(workspaceId, input.tagIds)
    await assertParent(workspaceId, null, input.parentAccountId)

    const account = await runAction(
      { action: 'account.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'account' } },
      async (tx) => {
        const created = await tx.account.create({
          data: {
            workspaceId,
            name,
            ...domain,
            website: blank(input.website),
            industry: blank(input.industry),
            sizeBand: blank(input.sizeBand),
            type: input.type,
            status: input.status,
            parentAccountId: input.parentAccountId ?? null,
            ownerMemberId: input.ownerMemberId ?? null,
            teamId: input.teamId ?? null,
            origin: ctx.origin === 'ui' ? 'manual' : 'api',
            externalProvider: blank(input.externalProvider),
            externalId: blank(input.externalId),
            createdById: actor.member.id,
          },
        })
        if (input.tagIds) await replaceTags(tx, 'account', workspaceId, created.id, input.tagIds)
        return {
          value: await load(tx, created.id),
          targetId: created.id,
          activities: [{ type: 'account.created', summary: { accountId: created.id, name }, subjects: [{ accountId: created.id }] }],
        }
      },
    )
    const sameDomain = account.domainKey
      ? await db.account.findMany({ where: { workspaceId, domainKey: account.domainKey, deletedAt: null, id: { not: account.id } }, orderBy: { name: 'asc' }, take: 20 })
      : []
    return { data: toAccount(account), duplicates: sameDomain.map(toAccountRef) }
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, accountId: string, input: AccountInput) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.write')
    const before = await liveAccount(db, workspaceId, accountId)
    if ('name' in input && !blank(input.name)) throw badRequest('Name is required', 'INVALID_NAME')
    const domain = domainFields(input.domain)
    await assertAssignees(workspaceId, input)
    await assertTags(workspaceId, input.tagIds)
    await assertParent(workspaceId, accountId, input.parentAccountId)

    return runAction(
      { action: 'account.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'account', id: accountId } },
      async (tx) => {
        await tx.account.update({
          where: { id: accountId },
          data: {
            name: 'name' in input ? blank(input.name)! : undefined,
            ...domain,
            website: 'website' in input ? blank(input.website) : undefined,
            industry: 'industry' in input ? blank(input.industry) : undefined,
            sizeBand: 'sizeBand' in input ? blank(input.sizeBand) : undefined,
            type: input.type,
            status: input.status,
            parentAccountId: input.parentAccountId,
            ownerMemberId: input.ownerMemberId,
            teamId: input.teamId,
            externalProvider: 'externalProvider' in input ? blank(input.externalProvider) : undefined,
            externalId: 'externalId' in input ? blank(input.externalId) : undefined,
          },
        })
        if (input.tagIds) await replaceTags(tx, 'account', workspaceId, accountId, input.tagIds)
        const after = await load(tx, accountId)
        const changes = diff(before, after, ['name', 'domain', 'website', 'industry', 'sizeBand', 'type', 'status', 'parentAccountId', 'ownerMemberId', 'teamId', 'externalProvider', 'externalId'])
        const subjects = [{ accountId }]
        const activities = []
        if (changes.ownerMemberId) activities.push({ type: 'owner.changed', summary: { accountId, name: after.name, from: before.ownerMemberId, to: after.ownerMemberId }, subjects })
        if (changes.type) activities.push({ type: 'account.type_changed', summary: { accountId, name: after.name, from: before.type, to: after.type }, subjects })
        if (changes.status) activities.push({ type: after.status === 'archived' ? 'account.archived' : 'account.restored', summary: { accountId, name: after.name }, subjects })
        return { value: toAccount(after), changes, activities }
      },
    )
  }

  // Soft delete. Contacts keep their history; the account disappears from them.
  async remove(ctx: WorkspaceCtx, workspaceId: string, accountId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.read')
    const account = await liveAccount(db, workspaceId, accountId)
    permit(actor, 'record.delete', { kind: 'record', ownerMemberId: account.ownerMemberId })
    await runAction(
      { action: 'account.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'account', id: accountId } },
      async (tx) => {
        await tx.account.update({ where: { id: accountId }, data: { deletedAt: new Date() } })
        await tx.account.updateMany({ where: { parentAccountId: accountId }, data: { parentAccountId: null } })
        return { value: null }
      },
    )
  }

  // The account's own activity, plus what happened to the people currently at it
  // since they joined it (capped) — not their earlier history elsewhere.
  async timeline(userId: string, workspaceId: string, accountId: string, opts: { cursor?: string; limit?: number }) {
    await authorize(userId, workspaceId, 'record.read')
    await liveAccount(db, workspaceId, accountId)
    const people = await db.contactAccount.findMany({
      where: { accountId, endedAt: null, contact: { deletedAt: null } },
      select: { contactId: true, startedAt: true, createdAt: true },
      take: 200,
    })
    return timeline(
      userId,
      workspaceId,
      {
        OR: [
          { subjectKey: subjectKey({ accountId }), accountId },
          ...people.map((p) => ({ contactId: p.contactId, occurredAt: { gte: p.startedAt ?? p.createdAt } })),
        ],
      },
      opts,
    )
  }
}
