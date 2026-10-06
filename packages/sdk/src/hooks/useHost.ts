import { useMutation } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'

// The workspace's shared bot channel (doc/12 §3): created on first open; opening it
// also welcomes the caller there once. Resolves to the channel's room.
export function useOpenWorkspaceChannel() {
  return useMutation({
    mutationFn: async (workspaceId: string) =>
      unwrap(await getApiClient().POST('/workspaces/{workspaceId}/channel', { params: { path: { workspaceId } } })).data,
  })
}
