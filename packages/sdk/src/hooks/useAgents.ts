import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type { UpdateAgentInput } from '../models'

// Communication agents (docs/agents). Everything lives under ['workspaces', id,
// 'agents'] so one invalidation refreshes the list, the editor and the river.

const agentKeys = {
  all: (workspaceId: string) => ['workspaces', workspaceId, 'agents'] as const,
  types: (workspaceId: string) => ['workspaces', workspaceId, 'agents', 'types'] as const,
  list: (workspaceId: string) => ['workspaces', workspaceId, 'agents', 'list'] as const,
  one: (workspaceId: string, agentId: string) => ['workspaces', workspaceId, 'agents', 'one', agentId] as const,
  preview: (workspaceId: string, agentId: string) => ['workspaces', workspaceId, 'agents', 'preview', agentId] as const,
  events: (workspaceId: string, agentId?: string) => ['workspaces', workspaceId, 'agents', 'events', agentId ?? 'all'] as const,
  event: (workspaceId: string, eventId: string) => ['workspaces', workspaceId, 'agents', 'event', eventId] as const,
}

const ws = (workspaceId: string) => ({ params: { path: { workspaceId } } })
const one = (workspaceId: string, agentId: string) => ({ params: { path: { workspaceId, agentId } } })

function useAgentsMutation<V, R>(workspaceId: string, fn: (vars: V) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.all(workspaceId) })
    },
  })
}

export function useAgentTypes(workspaceId: string | undefined) {
  return useQuery({
    queryKey: agentKeys.types(workspaceId ?? ''),
    enabled: !!workspaceId,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/agent-types', ws(workspaceId!))).data,
  })
}

export function useAgents(workspaceId: string | undefined) {
  return useQuery({
    queryKey: agentKeys.list(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/agents', ws(workspaceId!))).data,
  })
}

export function useAgent(workspaceId: string | undefined, agentId: string | undefined) {
  return useQuery({
    queryKey: agentKeys.one(workspaceId ?? '', agentId ?? ''),
    enabled: !!workspaceId && !!agentId,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/agents/{agentId}', one(workspaceId!, agentId!))).data,
  })
}

/** The report as it would go out now; refetched whenever the agent changes. */
export function useAgentPreview(workspaceId: string | undefined, agentId: string | undefined) {
  return useQuery({
    queryKey: agentKeys.preview(workspaceId ?? '', agentId ?? ''),
    enabled: !!workspaceId && !!agentId,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/agents/{agentId}/preview', one(workspaceId!, agentId!))).data,
  })
}

export function useCreateAgent(workspaceId: string) {
  return useAgentsMutation(workspaceId, async (typeKey: string) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/agents', { ...ws(workspaceId), body: { typeKey } })).data,
  )
}

export function useUpdateAgent(workspaceId: string, agentId: string) {
  return useAgentsMutation(workspaceId, async (body: UpdateAgentInput) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/agents/{agentId}', { ...one(workspaceId, agentId), body })).data,
  )
}

export function usePublishAgent(workspaceId: string, agentId: string) {
  return useAgentsMutation(workspaceId, async () => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/agents/{agentId}/publish', one(workspaceId, agentId))).data)
}

export function usePauseAgent(workspaceId: string, agentId: string) {
  return useAgentsMutation(workspaceId, async () => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/agents/{agentId}/pause', one(workspaceId, agentId))).data)
}

export function useDeleteAgent(workspaceId: string, agentId: string) {
  return useAgentsMutation(workspaceId, async () => unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/agents/{agentId}', one(workspaceId, agentId))).data)
}

export function useSendAgentTest(workspaceId: string, agentId: string) {
  return useMutation({
    mutationFn: async () => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/agents/{agentId}/test', one(workspaceId, agentId))).data,
  })
}

/** The activity river: upcoming and past events, latest scheduled time first. */
export function useAgentEvents(workspaceId: string | undefined, agentId?: string) {
  return useInfiniteQuery({
    queryKey: agentKeys.events(workspaceId ?? '', agentId),
    enabled: !!workspaceId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await getApiClient().GET('/workspaces/{workspaceId}/agent-events', {
          params: { path: { workspaceId: workspaceId! }, query: { agentId, cursor: pageParam, limit: 30 } },
        }),
      ),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
}

export function useAgentEvent(workspaceId: string | undefined, eventId: string | undefined) {
  return useQuery({
    queryKey: agentKeys.event(workspaceId ?? '', eventId ?? ''),
    enabled: !!workspaceId && !!eventId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/agent-events/{eventId}', { params: { path: { workspaceId: workspaceId!, eventId: eventId! } } })).data,
  })
}

export function useCancelAgentEvent(workspaceId: string) {
  return useAgentsMutation(workspaceId, async (eventId: string) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/agent-events/{eventId}/cancel', { params: { path: { workspaceId, eventId } } })).data,
  )
}
