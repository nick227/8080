import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'

export function useWorkspaceInsights(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['workspace-insights', workspaceId],
    enabled: !!workspaceId,
    refetchInterval: 30_000,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/insights', { params: { path: { workspaceId: workspaceId! } } })).data,
  })
}

export function useWorkspaceVocabulary(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['workspace-vocabulary', workspaceId],
    enabled: !!workspaceId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/vocabulary', { params: { path: { workspaceId: workspaceId! } } })).data,
  })
}

export function useUpdatePipeline(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { stages: { id?: string; key?: string; label: string; position: number; kind: 'open' | 'won' | 'lost'; archived?: boolean }[] }) =>
      unwrap(await getApiClient().PUT('/workspaces/{workspaceId}/pipeline', { params: { path: { workspaceId: workspaceId! } }, body })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspace-vocabulary', workspaceId] })
      void qc.invalidateQueries({ queryKey: ['workspace-insights', workspaceId] })
    },
  })
}

function invalidateVocab(qc: ReturnType<typeof useQueryClient>, workspaceId: string | undefined) {
  void qc.invalidateQueries({ queryKey: ['workspace-vocabulary', workspaceId] })
}

export function useCreateCategory(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { name: string }) =>
      unwrap(await getApiClient().POST('/workspaces/{workspaceId}/vocabulary/categories', { params: { path: { workspaceId: workspaceId! } }, body })).data,
    onSuccess: () => invalidateVocab(qc, workspaceId),
  })
}

export function useRenameCategory(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { from: string; to: string }) =>
      unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/vocabulary/categories', { params: { path: { workspaceId: workspaceId! } }, body })).data,
    onSuccess: () => invalidateVocab(qc, workspaceId),
  })
}

export function useDeleteCategory(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { name: string }) =>
      unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/vocabulary/categories', { params: { path: { workspaceId: workspaceId! } }, body })).data,
    onSuccess: () => invalidateVocab(qc, workspaceId),
  })
}

export function useUpdateFieldLabels(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { fields: { key: string; label: string; position?: number }[] }) =>
      unwrap(await getApiClient().PUT('/workspaces/{workspaceId}/vocabulary/fields', { params: { path: { workspaceId: workspaceId! } }, body })).data,
    onSuccess: () => {
      invalidateVocab(qc, workspaceId)
      void qc.invalidateQueries({ queryKey: ['contact-fields', workspaceId] })
    },
  })
}
