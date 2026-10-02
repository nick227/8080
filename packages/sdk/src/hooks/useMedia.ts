import { useMutation } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type { MediaType } from '../models'

export type UploadMediaInput = { file: Blob; type?: MediaType; name?: string; duration?: number }

// Upload first, then pass the returned media id in createItem({ mediaIds }).
export async function uploadMedia(input: UploadMediaInput) {
  const form = new FormData()
  form.append('file', input.file, input.name ?? 'upload')
  if (input.type) form.append('type', input.type)
  if (input.name) form.append('name', input.name)
  if (input.duration !== undefined) form.append('duration', String(input.duration))
  const result = await getApiClient().POST('/media', {
    body: form as any, // typed as the multipart schema; sent as-is
    bodySerializer: (body) => body as unknown as FormData,
  })
  return unwrap(result).data
}

// Removes an upload that was never used (an abandoned draft). 409 once it's attached.
export async function deleteMedia(mediaId: string) {
  unwrap(await getApiClient().DELETE('/media/{mediaId}', { params: { path: { mediaId } } }))
}

export function useUploadMedia() {
  return useMutation({ mutationFn: uploadMedia })
}

export type CreateYouTubeMediaInput = { url: string; durationMs?: number; embeddable?: boolean }

// Registers an external YouTube video as media (canonical id + metadata; nothing is
// downloaded). Attach the returned id via mediaIds, exactly like an upload.
export async function createYouTubeMedia(input: CreateYouTubeMediaInput) {
  return unwrap(await getApiClient().POST('/media/youtube', { body: { ...input, embeddable: input.embeddable ?? true } })).data
}

export function useCreateYouTubeMedia() {
  return useMutation({ mutationFn: createYouTubeMedia })
}
