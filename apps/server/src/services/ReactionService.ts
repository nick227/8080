import { db, type ReactionType } from '@project/db'
import { itemInclude, toItem } from '../lib/serialize'
import { ItemService } from './ItemService'
import { RoomService } from './RoomService'
import { streamHub } from './StreamHub'

const items = new ItemService()
const rooms = new RoomService()

export class ReactionService {
  async add(viewerId: string, itemId: string, type: ReactionType) {
    const item = await items.loadViewable(viewerId, itemId, { deletedAt: null })
    await db.roomMember.upsert({
      where: { roomId_userId: { roomId: item.roomId, userId: viewerId } },
      create: { roomId: item.roomId, userId: viewerId },
      update: {},
    })
    await db.reaction.createMany({ data: [{ itemId, userId: viewerId, type }], skipDuplicates: true })
    return this.publish(viewerId, itemId)
  }

  async remove(viewerId: string, itemId: string, type: ReactionType) {
    await items.loadViewable(viewerId, itemId)
    await db.reaction.deleteMany({ where: { itemId, userId: viewerId, type } })
    return this.publish(viewerId, itemId)
  }

  private async publish(viewerId: string, itemId: string) {
    const item = await db.item.findUniqueOrThrow({ where: { id: itemId }, include: itemInclude })
    streamHub.publish(item.roomId, { type: 'item.updated', actorId: viewerId, itemId: item.id, itemNumber: item.number })
    return toItem(item, viewerId)
  }
}
