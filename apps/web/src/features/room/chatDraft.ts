import { findYouTubeVideoId, MAX_UPLOAD_MB } from '@project/shared'
import type { MediaType, YouTubeDraft } from '../../api/types'

export type ChatAttachment = {
  id: string
  file: File
  type: MediaType
  previewUrl?: string
}

const LIMIT = MAX_UPLOAD_MB * 1024 * 1024

export function attachmentKind(file: File): MediaType {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'file'
}

export function attachmentError(file: File): string | undefined {
  if (file.size > LIMIT) return `${file.name} is over ${MAX_UPLOAD_MB}MB`
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return `${file.name} isn't a supported image`
  return undefined
}

export function takeYouTube(text: string): { text?: string; drafts: YouTubeDraft[] } {
  let rest = text
  const drafts: YouTubeDraft[] = []
  for (let i = 0; i < 4; i++) {
    const found = findYouTubeVideoId(rest)
    if (!found) break
    drafts.push({ kind: 'youtube', url: found.match, embeddable: true })
    rest = rest.replace(found.match, ' ')
  }
  const cleaned = rest.replace(/\s+/g, ' ').trim()
  return { text: cleaned || undefined, drafts }
}
