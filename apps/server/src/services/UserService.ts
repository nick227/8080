import { db } from '@project/db'
import { userInclude } from '../lib/session'
import { forbidden, httpError } from '../lib/errors'
import { MediaService, type StoredFile } from './MediaService'
import { ownedUploadKey, storage } from '../providers/storage'

const mediaService = new MediaService()

export class UserService {
  async updateMe(userId: string, input: { displayName?: string; avatarUrl?: string | null }) {
    const displayName = input.displayName?.trim()
    const previous = input.avatarUrl !== undefined ? await this.avatarUrl(userId) : undefined
    const user = await db.user.update({
      where: { id: userId },
      data: {
        profile: {
          update: {
            ...(displayName ? { displayName } : {}),
            ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
          },
        },
      },
      include: userInclude,
    })
    if (previous !== undefined) await tossOwnedAvatar(userId, previous, input.avatarUrl ?? null)
    return user
  }

  // Signed-in accounts only. The new image becomes the profile avatar and the
  // previous file is deleted — avatars are not kept.
  async replaceAvatar(userId: string, stored: StoredFile) {
    const current = await db.user.findUnique({ where: { id: userId }, include: userInclude })
    if (current?.isGuest) throw forbidden('Sign in to set an avatar')
    if (stored.kind !== 'image') throw httpError(415, 'Avatar must be an image', 'UNSUPPORTED_TYPE')

    const media = await mediaService.create(userId, stored, { name: 'avatar' })
    try {
      const user = await db.user.update({
        where: { id: userId },
        data: { profile: { update: { avatarUrl: media.url } } },
        include: userInclude,
      })
      await tossOwnedAvatar(userId, current?.profile?.avatarUrl, media.url)
      return user
    } catch (err) {
      await db.media.delete({ where: { id: media.id } }).catch(() => {})
      await storage().delete(stored.key)
      throw err
    }
  }

  private avatarUrl(userId: string) {
    return db.profile.findUnique({ where: { userId }, select: { avatarUrl: true } }).then((row) => row?.avatarUrl ?? null)
  }
}

// Deletes an avatar we stored, when nothing else still uses that file.
async function tossOwnedAvatar(userId: string, previousUrl: string | null | undefined, nextUrl: string | null) {
  if (!previousUrl || previousUrl === nextUrl) return
  const key = ownedUploadKey(previousUrl)
  if (!key) return
  const media = await db.media.findUnique({ where: { storageKey: key } })
  if (!media || media.ownerId !== userId || media.messageId) return
  const usedAsThumbnail = await db.room.count({ where: { thumbnailId: media.id } })
  if (usedAsThumbnail) return
  await db.media.delete({ where: { id: media.id } })
  await storage().delete(key)
}
