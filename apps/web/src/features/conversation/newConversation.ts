import { deleteMedia, getApiClient, unwrap, uploadMedia, type Room } from '@project/sdk'
import { parseYouTubeVideoId, youTubeThumbnailUrl } from '@project/shared'
import { resolveMediaIds } from '../../api/sendMedia'
import { isLocalMedia, isYouTubeDraft, type SendInput } from '../../api/types'

// A new conversation needs a name, a description and a thumbnail. The thumbnail is
// either one of the opening piece's own attachments (an image or a YouTube video —
// reused, not uploaded twice) or an image file (picked, or a still from a capture).
export type ThumbChoice =
  | { kind: 'attachment'; index: number; preview: string }
  | { kind: 'file'; file: Blob; preview: string }

export type ConversationDetails = { title: string; description: string; thumb: ThumbChoice }

// The server stores only these (MediaService allow-list). Saying so up front beats a
// 415 after Send — iPhones default to HEIC.
const THUMB_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
export const THUMB_ACCEPT = THUMB_TYPES.join(',')
export function thumbFileProblem(file: File): string | null {
  if (THUMB_TYPES.includes(file.type)) return null
  if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return 'HEIC photos aren’t supported yet — choose a JPEG or PNG (on iPhone: Settings → Camera → Formats → Most Compatible).'
  return 'Choose a JPEG, PNG, GIF or WebP image for the conversation.'
}

/** What a draft's own attachments can offer as a thumbnail (image or YouTube). Videos get a still elsewhere. */
export function attachmentThumb(media: SendInput['media']): ThumbChoice | null {
  for (const [index, m] of (media ?? []).entries()) {
    if (isYouTubeDraft(m)) {
      const id = parseYouTubeVideoId(m.url)
      if (id) return { kind: 'attachment', index, preview: youTubeThumbnailUrl(id) }
    } else if (isLocalMedia(m)) {
      if (m.type === 'image') return { kind: 'attachment', index, preview: '' }
    } else if (m.type === 'image') {
      return { kind: 'attachment', index, preview: m.url }
    } else if (m.source === 'youtube' && m.externalId) {
      return { kind: 'attachment', index, preview: youTubeThumbnailUrl(m.externalId) }
    }
  }
  return null
}

// What has been created so far for one draft. A retry continues from here instead of
// making a second room (or uploading the media again); abandoning cleans it up.
export type Progress = {
  draft?: unknown[] // what the uploads below were made from
  thumbFrom?: unknown // what the thumbnail below was made from
  mediaIds?: string[]
  thumbnailId?: string
  uploadedThumb?: boolean
  room?: Room
}

// Identity of a draft's content: the same take/file/link/text means the same uploads.
const draftKey = (opening: SendInput): unknown[] => [
  opening.text ?? '',
  ...(opening.media ?? []).map((m) => (isLocalMedia(m) ? m.file : isYouTubeDraft(m) ? m.url : m.id)),
]
const sameKey = (a: unknown[] | undefined, b: unknown[]) => !!a && a.length === b.length && a.every((v, i) => v === b[i])

export async function createConversation(details: ConversationDetails, opening: SendInput, progress: Progress): Promise<Room> {
  // A different take since the last attempt: its uploads don't apply (and an
  // attachment thumbnail pointed into them). A different thumbnail: likewise.
  const draft = draftKey(opening)
  const thumbFrom = details.thumb.kind === 'file' ? details.thumb.file : `attachment:${details.thumb.index}`
  const stale: string[] = []
  if (progress.draft && !sameKey(progress.draft, draft)) {
    stale.push(...(progress.mediaIds ?? []))
    progress.mediaIds = undefined
    if (!progress.room && !progress.uploadedThumb) progress.thumbnailId = undefined
  }
  if (!progress.room && progress.thumbFrom !== undefined && progress.thumbFrom !== thumbFrom) {
    if (progress.uploadedThumb && progress.thumbnailId) stale.push(progress.thumbnailId)
    progress.thumbnailId = undefined
    progress.uploadedThumb = false
  }
  if (stale.length) void Promise.allSettled(stale.map((id) => deleteMedia(id)))
  progress.draft = draft
  progress.thumbFrom = thumbFrom
  progress.mediaIds ??= await resolveMediaIds(opening.media)
  const mediaIds = progress.mediaIds
  if (!progress.thumbnailId) {
    if (details.thumb.kind === 'attachment') {
      progress.thumbnailId = mediaIds[details.thumb.index]
    } else {
      progress.thumbnailId = (await uploadMedia({ file: details.thumb.file, type: 'image', name: 'thumbnail' })).id
      progress.uploadedThumb = true
    }
  }

  const client = getApiClient()
  progress.room ??= unwrap(
    await client.POST('/rooms', {
      body: { title: details.title.trim(), description: details.description.trim(), thumbnailId: progress.thumbnailId!, visibility: 'public' },
    }),
  ).data

  unwrap(
    await client.POST('/rooms/{roomId}/items', {
      params: { path: { roomId: progress.room.id } },
      body: { text: opening.text, mediaIds: mediaIds.length ? mediaIds : undefined },
    }),
  )
  return progress.room
}

/** The draft was given up: delete what was uploaded for it but never used. Best effort. */
export async function abandon(progress: Progress) {
  // A room made for this draft whose opening piece never posted is an empty shell.
  if (progress.room) {
    const roomId = progress.room.id
    await getApiClient().DELETE('/rooms/{roomId}', { params: { path: { roomId } } }).catch(() => undefined)
  }
  const ids = [...(progress.mediaIds ?? []), ...(progress.uploadedThumb && progress.thumbnailId ? [progress.thumbnailId] : [])]
  await Promise.allSettled(ids.map((id) => deleteMedia(id)))
}
