// Helpers shared by the CRM record services (contacts, accounts; leads/deals later).
// Every related row is loaded with `workspaceId` in the where-clause — the
// same-workspace rule (workspaceIntegrity.ts) depends on it.
import { db, Prisma } from '@project/db'
import { badRequest, notFound } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { activityInclude, toActivity } from '../lib/serialize'

type Client = Prisma.TransactionClient | typeof db

/** Owner must be an active member and team a live team, both of this workspace. */
export async function assertAssignees(workspaceId: string, input: { ownerMemberId?: string | null; teamId?: string | null }) {
  if (input.ownerMemberId) {
    const owner = await db.workspaceMember.findFirst({ where: { id: input.ownerMemberId, workspaceId, status: 'active' } })
    if (!owner) throw badRequest('Owner must be an active member of this workspace', 'INVALID_OWNER')
  }
  if (input.teamId) {
    const team = await db.team.findFirst({ where: { id: input.teamId, workspaceId, archivedAt: null } })
    if (!team) throw badRequest('Team not found in this workspace', 'INVALID_TEAM')
  }
}

export async function assertTags(workspaceId: string, tagIds: string[] | undefined) {
  if (!tagIds?.length) return
  const unique = [...new Set(tagIds)]
  const found = await db.tag.count({ where: { id: { in: unique }, workspaceId } })
  if (found !== unique.length) throw badRequest('Tag not found in this workspace', 'INVALID_TAG')
}

export async function liveContact(client: Client, workspaceId: string, contactId: string) {
  const contact = await client.contact.findFirst({ where: { id: contactId, workspaceId, deletedAt: null } })
  if (!contact) throw notFound('Contact not found')
  return contact
}

export async function liveAccount(client: Client, workspaceId: string, accountId: string) {
  const account = await client.account.findFirst({ where: { id: accountId, workspaceId, deletedAt: null } })
  if (!account) throw notFound('Account not found')
  return account
}

/** Newest-first timeline of activities matching `subjects` (a where on ActivitySubject). */
export async function timeline(userId: string, workspaceId: string, subjects: Prisma.ActivitySubjectWhereInput, opts: { cursor?: string; limit?: number }) {
  const limit = normalizeLimit(opts.limit)
  const cursor = decodeKeyCursor<{ at: string; id: string }>(opts.cursor)
  let after: Prisma.ActivityWhereInput = {}
  if (cursor) {
    const at = new Date(cursor.at)
    if (Number.isNaN(at.getTime()) || typeof cursor.id !== 'string') throw badRequest('Invalid cursor')
    after = { OR: [{ occurredAt: { lt: at } }, { occurredAt: at, id: { lt: cursor.id } }] }
  }
  const rows = await db.activity.findMany({
    where: { workspaceId, subjects: { some: subjects }, ...after },
    include: activityInclude,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })
  const result = page(rows, limit, (last) => encodeKeyCursor({ at: last.occurredAt.toISOString(), id: last.id }))
  return { data: await redactRooms(userId, result.data.map(toActivity)), meta: result.meta }
}

// A conversation the viewer can't see stays anonymous on timelines (§6).
export async function redactRooms<T extends { roomId: string | null; itemId: string | null }>(userId: string, activities: T[]) {
  const visible = await visibleRoomIds(userId, activities.flatMap((a) => (a.roomId ? [a.roomId] : [])))
  return activities.map((a) => (a.roomId && !visible.has(a.roomId) ? { ...a, roomId: null, itemId: null } : a))
}

/** Of these rooms, the ones the viewer may see (live, and public or a member). */
export async function visibleRoomIds(userId: string, roomIds: string[]) {
  if (!roomIds.length) return new Set<string>()
  const rooms = await db.room.findMany({
    where: { id: { in: [...new Set(roomIds)] }, deletedAt: null, OR: [{ visibility: 'public' }, { members: { some: { userId } } }] },
    select: { id: true },
  })
  return new Set(rooms.map((r) => r.id))
}

/** Replace a record's tags (contact or account) with exactly `tagIds`. */
export async function replaceTags(tx: Prisma.TransactionClient, kind: 'contact' | 'account', workspaceId: string, recordId: string, tagIds: string[]) {
  const unique = [...new Set(tagIds)]
  if (kind === 'contact') {
    await tx.contactTag.deleteMany({ where: { contactId: recordId, tagId: { notIn: unique } } })
    await tx.contactTag.createMany({ data: unique.map((tagId) => ({ tagId, contactId: recordId, workspaceId })), skipDuplicates: true })
  } else {
    await tx.accountTag.deleteMany({ where: { accountId: recordId, tagId: { notIn: unique } } })
    await tx.accountTag.createMany({ data: unique.map((tagId) => ({ tagId, accountId: recordId, workspaceId })), skipDuplicates: true })
  }
}
