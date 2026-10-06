import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'

// "Brief me" (doc/13 D3): read-only. The viewer's last brief and whether it is stale;
// generating replaces it. Refetched on focus so a stale brief shows as stale.
const key = (workspaceId: string, contactId: string) => ['contactBrief', workspaceId, contactId] as const

export function useContactBrief(workspaceId: string | undefined, contactId: string | undefined) {
  return useQuery({
    queryKey: key(workspaceId ?? '', contactId ?? ''),
    enabled: !!workspaceId && !!contactId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/contacts/{contactId}/brief', { params: { path: { workspaceId: workspaceId!, contactId: contactId! } } })).data,
  })
}

export function useGenerateBrief(workspaceId: string, contactId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      unwrap(await getApiClient().POST('/workspaces/{workspaceId}/contacts/{contactId}/brief', { params: { path: { workspaceId, contactId } } })).data,
    onSuccess: (brief) => queryClient.setQueryData(key(workspaceId, contactId), brief),
  })
}
