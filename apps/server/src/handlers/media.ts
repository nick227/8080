import { MediaService, type StoredFile } from '../services/MediaService'
import { badRequest, conflict, notFound } from '../lib/errors'
import { YouTubeService } from '../services/YouTubeService'
import { db } from '@project/db'
import { storage } from '../providers/storage'
import { verifyPlaybackToken } from '../lib/playbackToken'

const mediaService = new MediaService()
const youTubeService = new YouTubeService()

// Streams the upload straight into storage. The web client appends `file` before
// `type`/`name`/`duration`, so the file is stored first and the fields read after it;
// the Media row is created once all parts are in. Any failure removes the object.
export async function uploadMedia(request: any, reply: any) {
  let stored: StoredFile | undefined
  const fields: Record<string, string> = {}

  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname === 'file' && !stored) stored = await mediaService.store(part)
        else part.file.resume() // not ours: drain it
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value
      }
    }
    if (!stored) throw badRequest('Missing "file" field', 'MISSING_FILE')
    const media = await mediaService.create(request.user.id, stored, { name: fields.name, duration: fields.duration })
    return reply.status(201).send({ data: media })
  } catch (err) {
    if (stored) await mediaService.discard(stored)
    throw err
  }
}

// An abandoned draft's upload: only the owner's, never one in use.
export async function deleteMedia(request: any, reply: any) {
  const media = await db.media.findFirst({ where: { id: request.params.mediaId, ownerId: request.user.id } })
  if (!media) throw notFound('Media not found')
  const usedAsThumbnail = await db.room.count({ where: { thumbnailId: media.id, deletedAt: null } })
  if (media.messageId || usedAsThumbnail) throw conflict('Media is in use', 'MEDIA_IN_USE')
  await db.media.delete({ where: { id: media.id } })
  if (media.storageKey) await storage().delete(media.storageKey)
  return reply.status(204).send()
}

// External YouTube video: referenced by canonical id, never downloaded.
export async function createYouTubeMedia(request: any, reply: any) {
  const media = await youTubeService.create(request.user.id, request.body)
  return reply.status(201).send({ data: media })
}

export async function playbackMedia(request: any, reply: any) {
  const { mediaId } = request.params
  const userId = request.user?.id
  // A valid token for exactly this media id authorizes on its own: media elements
  // with crossOrigin="anonymous" send no cookies (see lib/playbackToken.ts).
  const tokenOk = verifyPlaybackToken(request.query?.token, mediaId)

  // Neither a session nor a valid token: no media.
  if (!userId && !tokenOk) {
    return reply.status(401).send({ error: 'Sign in or use a current playback link', code: 'UNAUTHORIZED' })
  }

  // Find media and include relations needed for authorization
  const media = await db.media.findUnique({
    where: { id: mediaId },
    include: {
      message: {
        include: {
          items: {
            include: { room: { select: { visibility: true, id: true } } },
          },
        },
      },
      roomsAsThumbnail: { select: { visibility: true, id: true } }
    },
  })

  if (!media) return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' })
  if (!media.storageKey) return reply.status(400).send({ error: 'Not a stored file', code: 'BAD_REQUEST' })

  let authorized = tokenOk

  if (!authorized && media.ownerId === userId) {
    authorized = true
  } else if (!authorized) {
    // Collect all rooms where this media is visible (as part of a message or as a thumbnail)
    const roomIds = new Set<string>()
    let hasPublicRoom = false

    if (media.message) {
      for (const item of media.message.items) {
        if (item.room.visibility === 'public') hasPublicRoom = true
        roomIds.add(item.room.id)
      }
    }
    for (const room of media.roomsAsThumbnail) {
      if (room.visibility === 'public') hasPublicRoom = true
      roomIds.add(room.id)
    }

    if (hasPublicRoom) {
      authorized = true
    } else if (roomIds.size > 0) {
      // Check if user is a member of any of the private rooms
      const membership = await db.roomMember.findFirst({
        where: { userId, roomId: { in: Array.from(roomIds) } },
      })
      if (membership) authorized = true
    }
  }

  if (!authorized) return reply.status(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })

  const url = await storage().signUrl(media.storageKey)
  // Reply 307 Temporary Redirect to the signed URL
  return reply.redirect(url, 307)
}
