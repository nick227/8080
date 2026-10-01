import { uploadMedia } from '@project/sdk'
import type { Media, MediaType } from '../api/types'
import { toMedia } from '../api/adapt'

export type PreparedMedia = {
  file: Blob
  type: MediaType
  name?: string
  duration?: number
  previewUrl: string
}

export function mediaTypeFromFile(file: Blob): MediaType {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'file'
}

export function prepareMedia(file: Blob, options: { name?: string; type?: MediaType; duration?: number } = {}): PreparedMedia {
  return {
    file,
    type: options.type ?? mediaTypeFromFile(file),
    name: options.name,
    duration: options.duration,
    previewUrl: URL.createObjectURL(file),
  }
}

export async function persistMedia(media: PreparedMedia): Promise<Media> {
  return toMedia(await uploadMedia({ file: media.file, type: media.type, name: media.name, duration: media.duration }))
}

export function releasePreview(media?: Pick<PreparedMedia, 'previewUrl'> | null) {
  if (media?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(media.previewUrl)
}
