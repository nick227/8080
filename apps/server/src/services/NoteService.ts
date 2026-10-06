// Notes on CRM records (doc/09 §3, D10). The body is a Message (+ Media), so a
// voice or video note records and plays like any capture; media URLs carry
// playback tokens, so every workspace member can play them. A note is linked to
// its records through RecordLink and shows on their timelines (note.added).
import { db } from '@project/db'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { noteInclude, toNote } from '../lib/serialize'
import { runAction, subjectKey, type SubjectRef } from './actions'
import { ItemService } from './ItemService'
import { purgeCapture } from './purgeCapture'
import { liveAccount, liveContact, liveInventory } from './records'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize, permit } from './workspacePolicy'

const itemService = new ItemService()

export type SubjectIds = { contactIds?: string[]; accountIds?: string[]; inventoryIds?: string[] }

export const subjectsOf = (ids: SubjectIds): SubjectRef[] => [
  ...[...new Set(ids.contactIds ?? [])].map((contactId) => ({ contactId })),
  ...[...new Set(ids.accountIds ?? [])].map((accountId) => ({ accountId })),
  ...[...new Set(ids.inventoryIds ?? [])].map((inventoryId) => ({ inventoryId })),
]

async function assertSubjects(workspaceId: string, subjects: SubjectRef[]) {
  for (const s of subjects) {
    if ('contactId' in s) await liveContact(db, workspaceId, s.contactId)
    else if ('accountId' in s) await liveAccount(db, workspaceId, s.accountId)
    else await liveInventory(db, workspaceId, s.inventoryId)
  }
}

async function liveNote(workspaceId: string, noteId: string) {
  const note = await db.note.findFirst({ where: { id: noteId, workspaceId, deletedAt: null }, include: noteInclude })
  if (!note) throw notFound('Note not found')
  return note
}

const subjectOfLink = (l: { contactId: string | null; accountId: string | null; inventoryId: string | null }): SubjectRef =>
  l.contactId ? { contactId: l.contactId } : l.accountId ? { accountId: l.accountId } : { inventoryId: l.inventoryId! }

export class NoteService {
  async create(ctx: WorkspaceCtx, workspaceId: string, input: SubjectIds & { text?: string; mediaIds?: string[] }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'note.write')
    const text = input.text?.trim() || null
    const mediaIds = [...new Set(input.mediaIds ?? [])]
    if (!text && mediaIds.length === 0) throw badRequest('A note needs text or media', 'EMPTY_NOTE')
    const subjects = subjectsOf(input)
    if (subjects.length === 0) throw badRequest('Attach the note to at least one contact, account, or inventory', 'NO_SUBJECT')
    await assertSubjects(workspaceId, subjects)

    return runAction(
      { action: 'note.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'note' } },
      async (tx) => {
        // Same media rule as captures: the author's own, not yet attached.
        const message = await tx.message.create({ data: { authorId: ctx.user.id, text } })
        if (mediaIds.length) {
          const owned = await tx.media.count({ where: { id: { in: mediaIds }, ownerId: ctx.user.id, messageId: null } })
          if (owned !== mediaIds.length) throw badRequest('Media not found or already attached', 'INVALID_MEDIA')
          for (const [position, id] of mediaIds.entries()) await tx.media.update({ where: { id }, data: { messageId: message.id, position } })
        }
        const note = await tx.note.create({ data: { workspaceId, messageId: message.id, authorMemberId: actor.member.id } })
        await tx.recordLink.createMany({
          data: subjects.map((s) => ({ workspaceId, ...s, noteId: note.id, pairKey: `${subjectKey(s)}|note:${note.id}`, how: 'manual' as const, linkedById: actor.member.id })),
        })
        const full = await tx.note.findUniqueOrThrow({ where: { id: note.id }, include: noteInclude })
        return {
          value: toNote(full),
          targetId: note.id,
          activities: [{ type: 'note.added', summary: { noteId: note.id, excerpt: text?.slice(0, 140) ?? null, media: mediaIds.length }, subjects, object: { noteId: note.id } }],
        }
      },
    )
  }

  async list(userId: string, workspaceId: string, opts: { contactId?: string; accountId?: string; inventoryId?: string; cursor?: string; limit?: number }) {
    await authorize(userId, workspaceId, 'record.read')
    const subjects = [opts.contactId, opts.accountId, opts.inventoryId].filter(Boolean)
    if (subjects.length !== 1) throw badRequest('Give exactly one of contactId, accountId, or inventoryId', 'ONE_SUBJECT')
    const limit = normalizeLimit(opts.limit)
    const cursor = decodeKeyCursor<{ at: string; id: string }>(opts.cursor)
    const at = cursor ? new Date(cursor.at) : null
    if (cursor && (!at || Number.isNaN(at.getTime()) || typeof cursor.id !== 'string')) throw badRequest('Invalid cursor')
    const linkFilter = opts.contactId
      ? { contactId: opts.contactId }
      : opts.accountId
        ? { accountId: opts.accountId }
        : { inventoryId: opts.inventoryId }
    const rows = await db.note.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        links: { some: linkFilter },
        ...(at ? { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor!.id } }] } : {}),
      },
      include: noteInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const result = page(rows, limit, (last) => encodeKeyCursor({ at: last.createdAt.toISOString(), id: last.id }))
    return { data: result.data.map(toNote), meta: result.meta }
  }

  async get(userId: string, workspaceId: string, noteId: string) {
    await authorize(userId, workspaceId, 'record.read')
    return toNote(await liveNote(workspaceId, noteId))
  }

  async update(ctx: WorkspaceCtx, workspaceId: string, noteId: string, input: { pinned?: boolean }) {
    const actor = await authorize(ctx.user.id, workspaceId, 'note.write')
    const note = await liveNote(workspaceId, noteId)
    const pinnedAt = input.pinned === undefined ? undefined : input.pinned ? (note.pinnedAt ?? new Date()) : null
    return runAction(
      { action: 'note.update', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'note', id: noteId } },
      async (tx) => {
        const updated = await tx.note.update({ where: { id: noteId }, data: { pinnedAt }, include: noteInclude })
        return { value: toNote(updated), changes: { pinned: [note.pinnedAt !== null, updated.pinnedAt !== null] } }
      },
    )
  }

  // Soft delete; it leaves its records' timelines. Room placements are separate
  // publications and stay (D10); a note never shared is purged (file and text).
  async remove(ctx: WorkspaceCtx, workspaceId: string, noteId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'record.read')
    const note = await liveNote(workspaceId, noteId)
    permit(actor, 'note.delete', { kind: 'note', authorMemberId: note.authorMemberId })
    await runAction(
      { action: 'note.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'note', id: noteId } },
      async (tx) => {
        await tx.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } })
        await tx.activitySubject.deleteMany({ where: { activity: { noteId } } })
        return { value: null }
      },
    )
    const placed = await db.item.count({ where: { messageId: note.messageId, deletedAt: null } })
    if (placed === 0 && !note.message.deletedAt) await purgeCapture(note.messageId, note.message.media)
  }

  // Publishes the note into conversations through the existing author-only share.
  async share(ctx: WorkspaceCtx, workspaceId: string, noteId: string, roomIds: string[]) {
    const actor = await authorize(ctx.user.id, workspaceId, 'note.write')
    const note = await liveNote(workspaceId, noteId)
    if (note.authorMemberId !== actor.member.id) throw forbidden('Only the author can share this note')
    if (note.message.deletedAt) throw conflict('This note’s content was removed', 'CONTENT_REMOVED')
    const items = await itemService.share(ctx.user.id, note.messageId, roomIds)
    return runAction(
      { action: 'note.share', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { roomIds }, target: { type: 'note', id: noteId } },
      async () => ({
        value: items,
        result: { itemIds: items.map((i) => i.id) },
        activities: items.length
          ? [{ type: 'note.shared', summary: { noteId, rooms: items.length }, subjects: note.links.map(subjectOfLink), object: { noteId } }]
          : [],
      }),
    )
  }
}
