// RecordLink: "related to" between a CRM record (subject) and a note or a
// conversation (object) — doc/09 §3, §6. Conversations are linked, never owners.
// Linking adds the subject to the object's activities (so the record's timeline
// shows it); unlinking removes it again and records link.removed (Q-B).
// A room is only linkable by someone who can see it, and stays anonymous to
// workspace members who can't.
import { db, Prisma } from '@project/db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { recordLinkInclude, toRecordLink } from '../lib/serialize'
import { addSubjects, runAction, subjectKey, type ActivityObject, type SubjectRef } from './actions'
import { liveAccount, liveContact, liveInventory, visibleRoomIds } from './records'
import { RoomService } from './RoomService'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize } from './workspacePolicy'

const rooms = new RoomService()

type Tx = Prisma.TransactionClient
export type LinkInput = { contactId?: string; accountId?: string; inventoryId?: string; noteId?: string; roomId?: string; itemId?: string }

function subjectOf(input: LinkInput): SubjectRef {
  const subjects = [input.contactId, input.accountId, input.inventoryId].filter(Boolean)
  if (subjects.length !== 1) throw badRequest('Give exactly one of contactId, accountId, or inventoryId', 'ONE_SUBJECT')
  if (input.contactId) return { contactId: input.contactId }
  if (input.accountId) return { accountId: input.accountId }
  return { inventoryId: input.inventoryId! }
}

function objectOf(input: LinkInput): ActivityObject {
  if (!!input.noteId === !!input.roomId) throw badRequest('Give exactly one of noteId or roomId', 'ONE_OBJECT')
  if (input.itemId && !input.roomId) throw badRequest('itemId needs its roomId', 'ONE_OBJECT')
  return input.noteId ? { noteId: input.noteId } : { roomId: input.roomId!, itemId: input.itemId ?? null }
}

const objectKey = (o: ActivityObject) => ('noteId' in o ? `note:${o.noteId}` : o.itemId ? `item:${o.itemId}` : `room:${o.roomId}`)

// The activities that stand for an object on a timeline.
function objectActivities(tx: Tx, workspaceId: string, o: ActivityObject) {
  return tx.activity.findMany({
    where: 'noteId' in o ? { workspaceId, noteId: o.noteId } : { workspaceId, type: 'conversation.linked', roomId: o.roomId, itemId: o.itemId ?? null },
    select: { id: true, occurredAt: true },
  })
}

async function withRoomVisibility<T extends { roomId: string | null }>(userId: string, links: T[]) {
  const visible = await visibleRoomIds(userId, links.flatMap((l) => (l.roomId ? [l.roomId] : [])))
  return (l: T) => (l.roomId ? visible.has(l.roomId) : true)
}

export class LinkService {
  async create(ctx: WorkspaceCtx, workspaceId: string, input: LinkInput) {
    const actor = await authorize(ctx.user.id, workspaceId, 'link.write')
    const subject = subjectOf(input)
    const object = objectOf(input)
    if ('contactId' in subject) await liveContact(db, workspaceId, subject.contactId)
    else if ('accountId' in subject) await liveAccount(db, workspaceId, subject.accountId)
    else await liveInventory(db, workspaceId, subject.inventoryId)
    if ('noteId' in object) {
      if (!(await db.note.findFirst({ where: { id: object.noteId, workspaceId, deletedAt: null } }))) throw notFound('Note not found')
    } else {
      await rooms.viewable(ctx.user.id, object.roomId) // 404 for rooms the caller can't see
      if (object.itemId && !(await db.item.findFirst({ where: { id: object.itemId, roomId: object.roomId } }))) throw notFound('Item not found')
    }
    const pairKey = `${subjectKey(subject)}|${objectKey(object)}`
    if (await db.recordLink.findUnique({ where: { workspaceId_pairKey: { workspaceId, pairKey } } })) throw conflict('Already linked', 'ALREADY_LINKED')

    try {
      return await runAction(
        { action: 'link.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input, target: { type: 'link' } },
        async (tx) => {
          const link = await tx.recordLink.create({ data: { workspaceId, ...subject, ...object, pairKey, how: 'manual', linkedById: actor.member.id }, include: recordLinkInclude })
          // A note already has its activity; a conversation gets one per link.
          if ('noteId' in object) await addSubjects(tx, workspaceId, await objectActivities(tx, workspaceId, object), [subject])
          return {
            value: toRecordLink(link, true),
            targetId: link.id,
            activities: 'roomId' in object ? [{ type: 'conversation.linked', summary: { linkId: link.id }, subjects: [subject], object }] : [],
          }
        },
      )
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') throw conflict('Already linked', 'ALREADY_LINKED')
      throw err
    }
  }

  async remove(ctx: WorkspaceCtx, workspaceId: string, linkId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'link.write')
    const link = await db.recordLink.findFirst({ where: { id: linkId, workspaceId } })
    if (!link) throw notFound('Link not found')
    const subject: SubjectRef = link.contactId
      ? { contactId: link.contactId }
      : link.accountId
        ? { accountId: link.accountId }
        : { inventoryId: link.inventoryId! }
    const object: ActivityObject = link.noteId ? { noteId: link.noteId } : { roomId: link.roomId!, itemId: link.itemId }

    await runAction(
      { action: 'link.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: {}, target: { type: 'link', id: linkId } },
      async (tx) => {
        await tx.recordLink.delete({ where: { id: linkId } })
        const activities = await objectActivities(tx, workspaceId, object)
        await tx.activitySubject.deleteMany({ where: { activityId: { in: activities.map((a) => a.id) }, subjectKey: subjectKey(subject) } })
        return {
          value: null,
          result: { pairKey: link.pairKey },
          activities: [{ type: 'link.removed', summary: { linked: 'noteId' in object ? 'note' : 'conversation' }, subjects: [subject], object }],
        }
      },
    )
  }

  async list(userId: string, workspaceId: string, filter: LinkInput) {
    await authorize(userId, workspaceId, 'record.read')
    const keys = (['contactId', 'accountId', 'inventoryId', 'noteId', 'roomId'] as const).filter((k) => filter[k])
    if (keys.length !== 1) throw badRequest('Filter by exactly one of contactId, accountId, inventoryId, noteId or roomId', 'ONE_FILTER')
    // Links whose record was deleted drop out (the row stays for history).
    const links = await db.recordLink.findMany({
      where: {
        workspaceId,
        [keys[0]!]: filter[keys[0]!],
        AND: [
          { OR: [{ contactId: null }, { contact: { deletedAt: null } }] },
          { OR: [{ accountId: null }, { account: { deletedAt: null } }] },
        ],
        NOT: { note: { is: { deletedAt: { not: null } } } },
      },
      include: recordLinkInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    const visible = await withRoomVisibility(userId, links)
    return links.map((l) => toRecordLink(l, visible(l)))
  }

  // The room tile (§6): records linked to this conversation, from the workspaces
  // the viewer is an active member of. Nobody else sees that a link exists.
  async forRoom(userId: string, roomId: string) {
    await rooms.viewable(userId, roomId)
    const links = await db.recordLink.findMany({
      where: {
        roomId,
        workspace: { deletedAt: null, members: { some: { userId, status: 'active' } } },
        AND: [
          { OR: [{ contactId: null }, { contact: { deletedAt: null } }] },
          { OR: [{ accountId: null }, { account: { deletedAt: null } }] },
        ],
      },
      include: recordLinkInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return links.map((l) => toRecordLink(l, true))
  }
}
