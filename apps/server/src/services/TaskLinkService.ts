// A task related to a contact or a conversation (a room, or one item in it). Links
// are recorded on the task's history; a contact link also shows on the contact's
// timeline (the contact is the activity's subject). A conversation is only
// linkable by someone who can see it, and stays anonymous to members who can't.
import { db } from '@project/db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { runAction, type SubjectRef } from './actions'
import { liveContact, visibleRoomIds } from './records'
import { RoomService } from './RoomService'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize } from './workspacePolicy'

const rooms = new RoomService()

export type TaskLinkInput = { contactId?: string; roomId?: string; itemId?: string | null }

const linkInclude = {
  task: { select: { id: true, taskKey: true, title: true, status: true, deletedAt: true } },
  contact: { select: { id: true, displayName: true, deletedAt: true, mergedIntoId: true } },
  room: { select: { id: true, number: true, title: true, deletedAt: true } },
} as const

type LinkRow = Awaited<ReturnType<typeof loadLinks>>[number]

function loadLinks(where: object) {
  return db.taskLink.findMany({ where, include: linkInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
}

function toTaskLink(l: LinkRow, roomVisible: boolean) {
  const showRoom = !!l.room && roomVisible && !l.room.deletedAt
  return {
    id: l.id,
    workspaceId: l.workspaceId,
    task: { id: l.task.id, taskKey: l.task.taskKey, title: l.task.title, status: l.task.status },
    kind: l.contactId ? ('contact' as const) : ('conversation' as const),
    contact: l.contact ? { id: l.contact.id, name: l.contact.displayName } : null,
    // A conversation the viewer can't see: the link is shown without naming it.
    room: l.roomId ? (showRoom ? { id: l.room!.id, number: l.room!.number, title: l.room!.title } : null) : null,
    itemId: showRoom ? l.itemId : null,
    linkedById: l.linkedById,
    createdAt: l.createdAt,
  }
}

export class TaskLinkService {
  /** Exactly one of taskId, contactId, roomId. Deleted tasks and contacts drop out. */
  async list(userId: string, workspaceId: string, filter: { taskId?: string; contactId?: string; roomId?: string }) {
    await authorize(userId, workspaceId, 'task.read')
    const keys = (['taskId', 'contactId', 'roomId'] as const).filter((k) => filter[k])
    if (keys.length !== 1) throw badRequest('Filter by exactly one of taskId, contactId or roomId', 'ONE_FILTER')
    const links = await loadLinks({
      workspaceId,
      [keys[0]!]: filter[keys[0]!],
      task: { deletedAt: null },
      OR: [{ contactId: null }, { contact: { deletedAt: null } }],
    })
    const visible = await visibleRoomIds(userId, links.flatMap((l) => (l.roomId ? [l.roomId] : [])))
    // Listing by room is only for those who can see the room.
    const shown = keys[0] === 'roomId' ? links.filter((l) => visible.has(l.roomId!)) : links
    return { data: shown.map((l) => toTaskLink(l, !!l.roomId && visible.has(l.roomId))) }
  }

  async create(ctx: WorkspaceCtx, workspaceId: string, taskId: string, input: TaskLinkInput) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    if (!!input.contactId === !!input.roomId) throw badRequest('Give exactly one of contactId or roomId', 'ONE_OBJECT')
    if (input.itemId && !input.roomId) throw badRequest('itemId needs its roomId', 'ONE_OBJECT')
    const task = await db.workTask.findFirst({ where: { id: taskId, workspaceId, deletedAt: null }, select: { id: true, taskKey: true, title: true } })
    if (!task) throw notFound('Task not found')
    let label: string | null = null
    if (input.contactId) label = (await liveContact(db, workspaceId, input.contactId)).displayName
    else {
      await rooms.viewable(ctx.user.id, input.roomId!) // 404 for conversations the caller can't see
      if (input.itemId && !(await db.item.findFirst({ where: { id: input.itemId, roomId: input.roomId } }))) throw notFound('Item not found')
    }
    const object = input.contactId ? `contact:${input.contactId}` : input.itemId ? `item:${input.itemId}` : `room:${input.roomId}`
    const pairKey = `${taskId}|${object}`
    if (await db.taskLink.findUnique({ where: { workspaceId_pairKey: { workspaceId, pairKey } } })) throw conflict('Already linked', 'ALREADY_LINKED')
    const subjects: SubjectRef[] = input.contactId ? [{ contactId: input.contactId }] : []
    try {
      return await runAction(
        { action: 'task.link.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { taskId, ...input }, target: { type: 'task', id: taskId } },
        async (tx) => {
          const link = await tx.taskLink.create({
            data: { workspaceId, taskId, contactId: input.contactId ?? null, roomId: input.roomId ?? null, itemId: input.itemId ?? null, pairKey, linkedById: actor.member.id },
            include: linkInclude,
          })
          return {
            value: { data: toTaskLink(link, true) },
            // History names a contact; a conversation stays unnamed (it may be private).
            activities: [{ type: 'task.linked', object: { taskId }, subjects, summary: { taskId, taskKey: task.taskKey, title: task.title, linkId: link.id, kind: input.contactId ? 'contact' : 'conversation', ...(label ? { name: label } : {}) } }],
          }
        },
      )
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') throw conflict('Already linked', 'ALREADY_LINKED')
      throw err
    }
  }

  async remove(ctx: WorkspaceCtx, workspaceId: string, taskId: string, linkId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'task.write')
    const link = await db.taskLink.findFirst({ where: { id: linkId, taskId, workspaceId }, include: linkInclude })
    if (!link) throw notFound('Link not found')
    return runAction(
      { action: 'task.link.delete', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { taskId, linkId }, target: { type: 'task', id: taskId } },
      async (tx) => {
        await tx.taskLink.delete({ where: { id: linkId } })
        const subjects: SubjectRef[] = link.contactId ? [{ contactId: link.contactId }] : []
        return {
          value: { data: toTaskLink(link, false) },
          activities: [{ type: 'task.unlinked', object: { taskId }, subjects, summary: { taskId, taskKey: link.task.taskKey, title: link.task.title, kind: link.contactId ? 'contact' : 'conversation', ...(link.contact ? { name: link.contact.displayName } : {}) } }],
        }
      },
    )
  }
}
