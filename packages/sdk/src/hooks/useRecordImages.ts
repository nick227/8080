import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MAX_UPLOAD_MB } from '@project/shared'
import { ApiError, getApiClient, unwrap } from '../client'
import type { RecordImage } from '../models'
import { keys } from './keys'

export type RecordGalleryKind = 'contacts' | 'inventory' | 'company'

function imagesKey(workspaceId: string, kind: RecordGalleryKind, recordId: string) {
  return keys.recordImages(workspaceId, kind, recordId)
}

function invalidateGallery(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string, kind: RecordGalleryKind, recordId: string) {
  void queryClient.invalidateQueries({ queryKey: imagesKey(workspaceId, kind, recordId) })
  void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
  if (kind === 'company') void queryClient.invalidateQueries({ queryKey: ['company-profile', workspaceId] })
}

export function useRecordImages(workspaceId: string | undefined, kind: RecordGalleryKind, recordId: string | undefined) {
  return useQuery({
    queryKey: imagesKey(workspaceId ?? '', kind, recordId ?? ''),
    enabled: !!workspaceId && !!recordId,
    queryFn: async () => {
      if (kind === 'contacts') {
        return unwrap(
          await getApiClient().GET('/workspaces/{workspaceId}/contacts/{contactId}/images', {
            params: { path: { workspaceId: workspaceId!, contactId: recordId! } },
          }),
        ).data
      }
      if (kind === 'inventory') {
        return unwrap(
          await getApiClient().GET('/workspaces/{workspaceId}/inventory/{inventoryId}/images', {
            params: { path: { workspaceId: workspaceId!, inventoryId: recordId! } },
          }),
        ).data
      }
      return unwrap(
        await getApiClient().GET('/workspaces/{workspaceId}/company-profile/images', {
          params: { path: { workspaceId: workspaceId! } },
        }),
      ).data
    },
  })
}

export async function uploadRecordImage(workspaceId: string, kind: RecordGalleryKind, recordId: string, file: Blob, name?: string) {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new ApiError(413, `File exceeds the ${MAX_UPLOAD_MB}MB limit`, 'FILE_TOO_LARGE')
  }
  const form = new FormData()
  form.append('file', file, name ?? 'image')
  if (kind === 'contacts') {
    return unwrap(
      await getApiClient().POST('/workspaces/{workspaceId}/contacts/{contactId}/images', {
        params: { path: { workspaceId, contactId: recordId } },
        body: form as never,
        bodySerializer: (body) => body as unknown as FormData,
      }),
    ).data
  }
  if (kind === 'inventory') {
    return unwrap(
      await getApiClient().POST('/workspaces/{workspaceId}/inventory/{inventoryId}/images', {
        params: { path: { workspaceId, inventoryId: recordId } },
        body: form as never,
        bodySerializer: (body) => body as unknown as FormData,
      }),
    ).data
  }
  return unwrap(
    await getApiClient().POST('/workspaces/{workspaceId}/company-profile/images', {
      params: { path: { workspaceId } },
      body: form as never,
      bodySerializer: (body) => body as unknown as FormData,
    }),
  ).data
}

export function useUploadRecordImage(workspaceId: string, kind: RecordGalleryKind, recordId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: Blob) => uploadRecordImage(workspaceId, kind, recordId, file),
    onSuccess: () => invalidateGallery(queryClient, workspaceId, kind, recordId),
  })
}

export function useReorderRecordImages(workspaceId: string, kind: RecordGalleryKind, recordId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (imageIds: string[]) => {
      if (kind === 'contacts') {
        return unwrap(
          await getApiClient().PATCH('/workspaces/{workspaceId}/contacts/{contactId}/images/order', {
            params: { path: { workspaceId, contactId: recordId } },
            body: { imageIds },
          }),
        ).data
      }
      if (kind === 'inventory') {
        return unwrap(
          await getApiClient().PATCH('/workspaces/{workspaceId}/inventory/{inventoryId}/images/order', {
            params: { path: { workspaceId, inventoryId: recordId } },
            body: { imageIds },
          }),
        ).data
      }
      return unwrap(
        await getApiClient().PATCH('/workspaces/{workspaceId}/company-profile/images/order', {
          params: { path: { workspaceId } },
          body: { imageIds },
        }),
      ).data
    },
    onSuccess: () => invalidateGallery(queryClient, workspaceId, kind, recordId),
  })
}

export function useSetRecordImagePrimary(workspaceId: string, kind: RecordGalleryKind, recordId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (imageId: string) => {
      if (kind === 'contacts') {
        return unwrap(
          await getApiClient().PATCH('/workspaces/{workspaceId}/contacts/{contactId}/images/{imageId}/primary', {
            params: { path: { workspaceId, contactId: recordId, imageId } },
          }),
        ).data
      }
      if (kind === 'inventory') {
        return unwrap(
          await getApiClient().PATCH('/workspaces/{workspaceId}/inventory/{inventoryId}/images/{imageId}/primary', {
            params: { path: { workspaceId, inventoryId: recordId, imageId } },
          }),
        ).data
      }
      return unwrap(
        await getApiClient().PATCH('/workspaces/{workspaceId}/company-profile/images/{imageId}/primary', {
          params: { path: { workspaceId, imageId } },
        }),
      ).data
    },
    onSuccess: () => invalidateGallery(queryClient, workspaceId, kind, recordId),
  })
}

export function useDeleteRecordImage(workspaceId: string, kind: RecordGalleryKind, recordId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (imageId: string) => {
      if (kind === 'contacts') {
        unwrap(
          await getApiClient().DELETE('/workspaces/{workspaceId}/contacts/{contactId}/images/{imageId}', {
            params: { path: { workspaceId, contactId: recordId, imageId } },
          }),
        )
        return
      }
      if (kind === 'inventory') {
        unwrap(
          await getApiClient().DELETE('/workspaces/{workspaceId}/inventory/{inventoryId}/images/{imageId}', {
            params: { path: { workspaceId, inventoryId: recordId, imageId } },
          }),
        )
        return
      }
      unwrap(
        await getApiClient().DELETE('/workspaces/{workspaceId}/company-profile/images/{imageId}', {
          params: { path: { workspaceId, imageId } },
        }),
      )
    },
    onSuccess: () => invalidateGallery(queryClient, workspaceId, kind, recordId),
  })
}

export type { RecordImage }
