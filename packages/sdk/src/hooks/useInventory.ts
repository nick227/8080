import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type { CreateInventoryInput, RecordStatus, UpdateInventoryInput } from '../models'
import { keys } from './keys'

// Inventory is what the workspace sells; an interest ties a contact to an item.
// Writes invalidate the workspace subtree, like the other record hooks.

function useWorkspaceWrite<V, R>(workspaceId: string, fn: (vars: V) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) }),
  })
}

export type InventoryListParams = { q?: string; category?: string; status?: RecordStatus; limit?: number }

export function useInventory(workspaceId: string | undefined, params: InventoryListParams = {}) {
  return useInfiniteQuery({
    queryKey: keys.inventory(workspaceId ?? '', params),
    enabled: !!workspaceId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/inventory', { params: { path: { workspaceId: workspaceId! }, query: { ...params, cursor: pageParam } } })),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
}

export function useCreateInventoryItem(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (body: CreateInventoryInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/inventory', { params: { path: { workspaceId } }, body })).data,
  )
}

export function useUpdateInventoryItem(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async ({ inventoryId, ...body }: UpdateInventoryInput & { inventoryId: string }) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/inventory/{inventoryId}', { params: { path: { workspaceId, inventoryId } }, body })).data,
  )
}

export function useDeleteInventoryItem(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (inventoryId: string) => {
    unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/inventory/{inventoryId}', { params: { path: { workspaceId, inventoryId } } }))
  })
}

export function useContactInterests(workspaceId: string | undefined, contactId: string | undefined) {
  return useQuery({
    queryKey: keys.interests(workspaceId ?? '', contactId ?? ''),
    enabled: !!workspaceId && !!contactId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/contacts/{contactId}/interests', { params: { path: { workspaceId: workspaceId!, contactId: contactId! } } })).data,
  })
}

export function useAddContactInterest(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async ({ contactId, inventoryId }: { contactId: string; inventoryId: string }) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/contacts/{contactId}/interests', { params: { path: { workspaceId, contactId } }, body: { inventoryId } })).data,
  )
}

export function useRemoveContactInterest(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async ({ contactId, inventoryId }: { contactId: string; inventoryId: string }) => {
    unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/contacts/{contactId}/interests/{inventoryId}', { params: { path: { workspaceId, contactId, inventoryId } } }))
  })
}

export function useInventoryItem(workspaceId: string | undefined, inventoryId: string | undefined) {
  return useQuery({
    queryKey: keys.inventoryItem(workspaceId ?? '', inventoryId ?? ''),
    enabled: !!workspaceId && !!inventoryId,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/inventory/{inventoryId}', {
      params: { path: { workspaceId: workspaceId!, inventoryId: inventoryId! } },
    })).data,
  })
}
