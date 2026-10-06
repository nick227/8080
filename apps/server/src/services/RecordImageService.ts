// Gallery for contacts and inventory items. Media is authoritative for bytes;
// parent imageUrl is a denormalized primary projection maintained here only.
import { db, Prisma, type RecordImageSubject } from '@project/db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { playbackUrl } from '../lib/serialize'
import { ownedMediaId } from '../providers/storage'
import { MediaService, type StoredFile } from './MediaService'
import { authorize } from './workspacePolicy'

export const MAX_RECORD_IMAGES = 12

export type GallerySubject = RecordImageSubject

type Tx = Prisma.TransactionClient

const mediaService = new MediaService()

const toImage = (row: {
  id: string
  mediaId: string
  sortOrder: number
  isPrimary: boolean
  createdAt: Date
}) => ({
  id: row.id,
  mediaId: row.mediaId,
  url: playbackUrl(row.mediaId),
  sortOrder: row.sortOrder,
  isPrimary: row.isPrimary,
  createdAt: row.createdAt,
})

async function lockSubject(tx: Tx, workspaceId: string, subjectType: GallerySubject, subjectId: string) {
  if (subjectType === 'contact') {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM Contact WHERE id = ${subjectId} AND workspaceId = ${workspaceId} AND deletedAt IS NULL FOR UPDATE`
    if (!rows.length) throw notFound('Contact not found')
  } else {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM Inventory WHERE id = ${subjectId} AND workspaceId = ${workspaceId} FOR UPDATE`
    if (!rows.length) throw notFound('Item not found')
  }
}

async function syncPrimary(tx: Tx, workspaceId: string, subjectType: GallerySubject, subjectId: string) {
  const primary = await tx.recordImage.findFirst({
    where: { workspaceId, subjectType, subjectId, isPrimary: true },
    select: { mediaId: true },
  })
  const imageUrl = primary ? playbackUrl(primary.mediaId) : null
  if (subjectType === 'contact') {
    await tx.contact.updateMany({ where: { id: subjectId, workspaceId }, data: { imageUrl } })
  } else {
    await tx.inventory.updateMany({ where: { id: subjectId, workspaceId }, data: { imageUrl } })
  }
}

export class RecordImageService {
  async list(userId: string, workspaceId: string, subjectType: GallerySubject, subjectId: string) {
    await authorize(userId, workspaceId, 'record.read')
    await this.assertSubject(workspaceId, subjectType, subjectId)
    const rows = await db.recordImage.findMany({
      where: { workspaceId, subjectType, subjectId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
    return { data: rows.map(toImage) }
  }

  async attach(
    userId: string,
    workspaceId: string,
    subjectType: GallerySubject,
    subjectId: string,
    stored: StoredFile,
  ) {
    await authorize(userId, workspaceId, 'record.write')
    if (stored.kind !== 'image') {
      await mediaService.discard(stored)
      throw badRequest('Gallery accepts image files only', 'UNSUPPORTED_TYPE')
    }
    const media = await mediaService.create(userId, stored, {})
    try {
      return await db.$transaction(async (tx) => {
        await lockSubject(tx, workspaceId, subjectType, subjectId)
        const count = await tx.recordImage.count({ where: { workspaceId, subjectType, subjectId } })
        if (count >= MAX_RECORD_IMAGES) throw conflict(`At most ${MAX_RECORD_IMAGES} images per record`, 'GALLERY_FULL')
        const created = await tx.recordImage.create({
          data: {
            workspaceId,
            subjectType,
            subjectId,
            mediaId: media.id,
            sortOrder: count,
            isPrimary: count === 0,
          },
        })
        await syncPrimary(tx, workspaceId, subjectType, subjectId)
        return toImage(created)
      })
    } catch (err) {
      const stillUsed = await db.recordImage.findFirst({ where: { mediaId: media.id } })
      if (!stillUsed) await this.discardOrphanMedia(media.id)
      throw err
    }
  }

  async reorder(
    userId: string,
    workspaceId: string,
    subjectType: GallerySubject,
    subjectId: string,
    imageIds: string[],
  ) {
    await authorize(userId, workspaceId, 'record.write')
    if (!Array.isArray(imageIds) || !imageIds.length) throw badRequest('imageIds is required', 'INVALID_ORDER')
    if (new Set(imageIds).size !== imageIds.length) throw badRequest('Duplicate image ids', 'INVALID_ORDER')
    await db.$transaction(async (tx) => {
      await lockSubject(tx, workspaceId, subjectType, subjectId)
      const existing = await tx.recordImage.findMany({
        where: { workspaceId, subjectType, subjectId },
        select: { id: true },
      })
      const existingIds = new Set(existing.map((row) => row.id))
      if (existingIds.size !== imageIds.length || imageIds.some((id) => !existingIds.has(id))) {
        throw badRequest('Order must list every image for this record exactly once', 'INVALID_ORDER')
      }
      for (let i = 0; i < imageIds.length; i++) {
        await tx.recordImage.update({ where: { id: imageIds[i]! }, data: { sortOrder: i } })
      }
    })
    return this.list(userId, workspaceId, subjectType, subjectId)
  }

  async setPrimary(
    userId: string,
    workspaceId: string,
    subjectType: GallerySubject,
    subjectId: string,
    imageId: string,
  ) {
    await authorize(userId, workspaceId, 'record.write')
    await db.$transaction(async (tx) => {
      await lockSubject(tx, workspaceId, subjectType, subjectId)
      const target = await tx.recordImage.findFirst({ where: { id: imageId, workspaceId, subjectType, subjectId } })
      if (!target) throw notFound('Image not found')
      await tx.recordImage.updateMany({
        where: { workspaceId, subjectType, subjectId, isPrimary: true },
        data: { isPrimary: false },
      })
      await tx.recordImage.update({ where: { id: imageId }, data: { isPrimary: true } })
      await syncPrimary(tx, workspaceId, subjectType, subjectId)
    })
    return this.list(userId, workspaceId, subjectType, subjectId)
  }

  async remove(
    userId: string,
    workspaceId: string,
    subjectType: GallerySubject,
    subjectId: string,
    imageId: string,
  ) {
    await authorize(userId, workspaceId, 'record.write')
    let mediaId: string | null = null
    await db.$transaction(async (tx) => {
      await lockSubject(tx, workspaceId, subjectType, subjectId)
      const target = await tx.recordImage.findFirst({ where: { id: imageId, workspaceId, subjectType, subjectId } })
      if (!target) throw notFound('Image not found')
      mediaId = target.mediaId
      const wasPrimary = target.isPrimary
      await tx.recordImage.delete({ where: { id: imageId } })
      const remaining = await tx.recordImage.findMany({
        where: { workspaceId, subjectType, subjectId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      })
      for (let i = 0; i < remaining.length; i++) {
        await tx.recordImage.update({ where: { id: remaining[i]!.id }, data: { sortOrder: i } })
      }
      if (wasPrimary) {
        await tx.recordImage.updateMany({
          where: { workspaceId, subjectType, subjectId },
          data: { isPrimary: false },
        })
        if (remaining[0]) {
          await tx.recordImage.update({ where: { id: remaining[0].id }, data: { isPrimary: true } })
        }
      }
      await syncPrimary(tx, workspaceId, subjectType, subjectId)
    })
    if (mediaId) await this.discardOrphanMedia(mediaId)
  }

  /** Drop gallery rows when a contact or inventory item is hard-deleted. */
  async purgeSubject(tx: Tx, workspaceId: string, subjectType: GallerySubject, subjectId: string) {
    const rows = await tx.recordImage.findMany({ where: { workspaceId, subjectType, subjectId }, select: { mediaId: true } })
    await tx.recordImage.deleteMany({ where: { workspaceId, subjectType, subjectId } })
    return rows.map((row) => row.mediaId)
  }

  /**
   * Idempotent: for inventory rows whose imageUrl is our playback URL and that
   * have no gallery yet, create one primary RecordImage.
   */
  async migrateLegacyInventory(workspaceId?: string) {
    const items = await db.inventory.findMany({
      where: {
        imageUrl: { not: null },
        ...(workspaceId ? { workspaceId } : {}),
      },
      select: { id: true, workspaceId: true, imageUrl: true },
    })
    let created = 0
    let skipped = 0
    for (const item of items) {
      const mediaId = ownedMediaId(item.imageUrl)
      if (!mediaId) {
        skipped++
        continue
      }
      const media = await db.media.findUnique({ where: { id: mediaId }, select: { id: true, kind: true } })
      if (!media || media.kind !== 'image') {
        skipped++
        continue
      }
      const existing = await db.recordImage.count({
        where: { workspaceId: item.workspaceId, subjectType: 'inventory', subjectId: item.id },
      })
      if (existing) {
        skipped++
        continue
      }
      try {
        await db.recordImage.create({
          data: {
            workspaceId: item.workspaceId,
            subjectType: 'inventory',
            subjectId: item.id,
            mediaId,
            sortOrder: 0,
            isPrimary: true,
          },
        })
        created++
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          skipped++
          continue
        }
        throw err
      }
    }
    return { created, skipped }
  }

  private async assertSubject(workspaceId: string, subjectType: GallerySubject, subjectId: string) {
    if (subjectType === 'contact') {
      const row = await db.contact.findFirst({ where: { id: subjectId, workspaceId, deletedAt: null }, select: { id: true } })
      if (!row) throw notFound('Contact not found')
    } else {
      const row = await db.inventory.findFirst({ where: { id: subjectId, workspaceId }, select: { id: true } })
      if (!row) throw notFound('Item not found')
    }
  }

  async discardOrphanMedia(mediaId: string) {
    const media = await db.media.findUnique({ where: { id: mediaId } })
    if (!media || media.messageId) return
    const still = await db.recordImage.count({ where: { mediaId } })
    if (still) return
    const thumb = await db.room.count({ where: { thumbnailId: mediaId, deletedAt: null } })
    if (thumb) return
    await db.media.delete({ where: { id: mediaId } }).catch(() => undefined)
    if (media.storageKey) {
      await mediaService.discard({
        key: media.storageKey,
        mimeType: media.mimeType,
        kind: media.kind,
        size: media.size,
      })
    }
  }
}
