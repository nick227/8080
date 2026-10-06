import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'

// Agent proposals (doc/13 §5). The chat card and a record page render the same
// server row; chat updates arrive through the room stream (item.updated).
export type ProposalAction = 'apply' | 'dismiss' | 'undo' | 'revert' | 'refresh'

const key = (workspaceId: string, targetType?: string, targetId?: string) => ['proposals', workspaceId, targetType ?? '', targetId ?? ''] as const

export function useProposals(workspaceId: string | undefined, target: { targetType?: string; targetId?: string } = {}) {
  return useQuery({
    queryKey: key(workspaceId ?? '', target.targetType, target.targetId),
    enabled: !!workspaceId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/proposals', { params: { path: { workspaceId: workspaceId! }, query: target } })).data,
  })
}

export function useProposalAction(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ proposalId, action }: { proposalId: string; action: ProposalAction }) => {
      const params = { params: { path: { workspaceId, proposalId } } }
      const client = getApiClient()
      const res =
        action === 'apply' ? await client.POST('/workspaces/{workspaceId}/proposals/{proposalId}/apply', params)
        : action === 'dismiss' ? await client.POST('/workspaces/{workspaceId}/proposals/{proposalId}/dismiss', params)
        : action === 'undo' ? await client.POST('/workspaces/{workspaceId}/proposals/{proposalId}/undo', params)
        : action === 'revert' ? await client.POST('/workspaces/{workspaceId}/proposals/{proposalId}/revert', params)
        : await client.POST('/workspaces/{workspaceId}/proposals/{proposalId}/refresh', params)
      return unwrap(res).data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['proposals', workspaceId] }),
  })
}
