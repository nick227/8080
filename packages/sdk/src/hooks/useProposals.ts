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

// Change a pending proposal before Apply (kinds with `editable`). The handler
// re-validates; the card updates through the room stream too.
export function useEditProposal(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ proposalId, edits }: { proposalId: string; edits: Record<string, string> }) =>
      unwrap(await getApiClient().PUT('/workspaces/{workspaceId}/proposals/{proposalId}', { params: { path: { workspaceId, proposalId } }, body: { edits } })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['proposals', workspaceId] }),
  })
}

// "Add notes" (doc/13 §10): a messy note → a proposal, or a choice / question first.
export function useAddCrmNote(workspaceId: string) {
  return useMutation({
    mutationFn: async (body: { text?: string; draftId?: string; about?: string; contactId?: string; accountId?: string }) =>
      unwrap(await getApiClient().POST('/workspaces/{workspaceId}/crm/notes', { params: { path: { workspaceId } }, body })).data,
  })
}
