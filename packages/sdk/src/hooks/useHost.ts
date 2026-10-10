import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'

// The workspace's shared bot channel (doc/12 §3): created on first open; opening it
// also welcomes the caller there once. Resolves to the channel's room.
export function useOpenWorkspaceChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (workspaceId: string) =>
      unwrap(await getApiClient().POST('/workspaces/{workspaceId}/channel', { params: { path: { workspaceId } } })).data,
    onSuccess: (_data, workspaceId) => {
      void queryClient.invalidateQueries({ queryKey: ['workspaceChannel', workspaceId] })
    },
  })
}

/** The channel's room and whether you're in it. Read-only: never joins or welcomes. */
export function useWorkspaceChannel(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['workspaceChannel', workspaceId ?? ''],
    enabled: !!workspaceId,
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/channel', { params: { path: { workspaceId: workspaceId! } } })).data,
  })
}
