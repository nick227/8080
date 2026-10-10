// Conversations listed under a company (redesign 00-decisions.md D3). Rooms stay
// platform-level (doc/09 D5): a link only decides where a room is listed, never who
// can see it, so the list is filtered by the viewer's own room access. A room belongs
// to at most one company; only its owner can add it (nobody claims someone else's
// room). The company's channel is listed without a link row.
import { db } from '@project/db'
import { conflict, forbidden, httpError, notFound } from '../lib/errors'
import { runAction } from './actions'
import { RoomService } from './RoomService'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { authorize, can } from './workspacePolicy'

const rooms = new RoomService()

export class CompanyRoomService {
  async list(userId: string, workspaceId: string, opts: { cursor?: string; limit?: number }) {
    await authorize(userId, workspaceId, 'conversation.read')
    return rooms.listForCompany(userId, workspaceId, opts)
  }

  async link(ctx: WorkspaceCtx, workspaceId: string, roomId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'conversation.link')
    const room = await rooms.viewable(ctx.user.id, roomId) // 404 for rooms the caller can't see
    if (room.ownerId !== ctx.user.id) throw httpError(403, 'Only the conversation’s owner can add it to a company', 'NOT_ROOM_OWNER')
    const channel = await db.workspaceChannel.findUnique({ where: { roomId } })
    const existing = await db.workspaceRoom.findUnique({ where: { roomId } })
    if (channel || existing) {
      const owner = channel?.workspaceId ?? existing!.workspaceId
      throw conflict(owner === workspaceId ? 'Already in this company' : 'This conversation is already in another company', owner === workspaceId ? 'ALREADY_LINKED' : 'ROOM_LINKED')
    }
    try {
      await runAction(
        { action: 'conversation.link', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { roomId }, target: { type: 'room', id: roomId } },
        async (tx) => {
          await tx.workspaceRoom.create({ data: { workspaceId, roomId, linkedByMemberId: actor.member.id } })
          return { value: null }
        },
      )
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') throw conflict('This conversation is already in a company', 'ROOM_LINKED')
      throw err
    }
    return { data: await rooms.get(ctx.user.id, roomId) }
  }

  async unlink(ctx: WorkspaceCtx, workspaceId: string, roomId: string) {
    const actor = await authorize(ctx.user.id, workspaceId, 'conversation.read')
    const link = await db.workspaceRoom.findFirst({ where: { roomId, workspaceId }, include: { room: { select: { ownerId: true } } } })
    if (!link) throw notFound('Conversation not in this company')
    if (link.room.ownerId !== ctx.user.id && !can(actor.member, 'conversation.unlink')) throw forbidden('Only the conversation’s owner or an admin can remove it')
    await runAction(
      { action: 'conversation.unlink', workspaceId, actor: memberActor(actor), origin: ctx.origin, input: { roomId }, target: { type: 'room', id: roomId } },
      async (tx) => {
        await tx.workspaceRoom.delete({ where: { id: link.id } })
        return { value: null }
      },
    )
    return { data: null }
  }

  /** The company a room is listed under, named only to that company's members. */
  async companyOf(userId: string, roomId: string) {
    await rooms.viewable(userId, roomId)
    const [link, channel] = await Promise.all([
      db.workspaceRoom.findUnique({ where: { roomId }, select: { workspaceId: true } }),
      db.workspaceChannel.findUnique({ where: { roomId }, select: { workspaceId: true } }),
    ])
    const workspaceId = link?.workspaceId ?? channel?.workspaceId
    if (!workspaceId) return { data: null }
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId, userId, status: 'active', workspace: { deletedAt: null } },
      select: { workspace: { select: { id: true, name: true } } },
    })
    return { data: member ? { id: member.workspace.id, name: member.workspace.name, channel: !!channel } : null }
  }
}
