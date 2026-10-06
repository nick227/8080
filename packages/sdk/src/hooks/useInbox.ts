import { useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getApiBaseUrl, getApiClient, unwrap } from '../client'
import type { SendComposeInput } from '../models'
import { keys } from './keys'

function useWorkspaceWrite<V, R>(workspaceId: string, fn: (vars: V) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) }) },
  })
}

export type InboxListParams = { archived?: boolean; unread?: boolean; starred?: boolean }

export function useInboxItems(workspaceId: string | undefined, params: InboxListParams = {}) {
  return useInfiniteQuery({
    queryKey: keys.inbox(workspaceId ?? '', params),
    enabled: !!workspaceId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/inbox', { params: { path: { workspaceId: workspaceId! }, query: { ...params, cursor: pageParam } } })),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
}

export function useInboxStream(workspaceId: string | undefined) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!workspaceId || typeof EventSource === 'undefined') return
    const source = new EventSource(`${getApiBaseUrl()}/workspaces/${workspaceId}/inbox/stream`, { withCredentials: true })
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'inbox'] }) }
    source.addEventListener('inbox.created', refresh)
    return () => source.close()
  }, [workspaceId, queryClient])
}

export function useReadInboxItem(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (vars: { inboxItemId: string; unread: boolean }) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/inbox/{inboxItemId}/read', { params: { path: { workspaceId, inboxItemId: vars.inboxItemId } }, body: { unread: vars.unread } })).data,
  )
}

export function useStarInboxItem(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (vars: { inboxItemId: string; starred: boolean }) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/inbox/{inboxItemId}/star', { params: { path: { workspaceId, inboxItemId: vars.inboxItemId } }, body: { starred: vars.starred } })).data,
  )
}

export function useArchiveInboxItem(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (vars: { inboxItemId: string; archived: boolean }) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/inbox/{inboxItemId}/archive', { params: { path: { workspaceId, inboxItemId: vars.inboxItemId } }, body: { archived: vars.archived } })).data,
  )
}

export function useSendCompose(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (body: SendComposeInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/compose', { params: { path: { workspaceId } }, body })).data,
  )
}
