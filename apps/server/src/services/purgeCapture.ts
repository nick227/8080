import { db } from '@project/db'
import { storage } from '../providers/storage'
import { recountRooms } from './roomStats'

type StoredMedia = { id: string; storageKey: string | null }

// Removes the capture itself: the file, the media rows, and the text. Every
// placement of that message is tombstoned so a share cannot keep the bytes, and
// the item row stays so replies keep their parent.
export async function purgeCapture(messageId: string, media: StoredMedia[]) {
  await Promise.all(media.flatMap((file) => (file.storageKey ? [storage().delete(file.storageKey)] : [])))

  const mediaIds = media.map((file) => file.id)
  return db.$transaction(async (tx) => {
    if (mediaIds.length) {
      await tx.room.updateMany({ where: { thumbnailId: { in: mediaIds } }, data: { thumbnailId: null } })
      await tx.media.deleteMany({ where: { id: { in: mediaIds } } })
    }
    await tx.message.update({ where: { id: messageId }, data: { text: null, deletedAt: new Date() } })
    const live = await tx.item.findMany({
      where: { messageId, deletedAt: null },
      select: { id: true, roomId: true, number: true },
    })
    if (live.length) {
      await tx.item.updateMany({ where: { id: { in: live.map((row) => row.id) } }, data: { deletedAt: new Date() } })
      await recountRooms(tx, live.map((row) => row.roomId))
    }
    return live
  })
}
