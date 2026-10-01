import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type { SendMessageInput, ShareMessageInput, Item, PaginatedMeta, ReplyToItemInput } from '../models'
import { keys } from './keys'

type ItemsPage = { data: Item[]; meta: PaginatedMeta }
export type ItemsCache = InfiniteData<ItemsPage>

// Room items ascending by number. Pages are fetched automatically until exhausted,
// because branch derivation (parentId → tree) needs the whole room.
export function useRoomItems(roomId: string | undefined, opts: { pageSize?: number } = {}) {
  const query = useInfiniteQuery({
    queryKey: keys.items(roomId ?? ''),
    enabled: !!roomId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await getApiClient().GET('/rooms/{roomId}/items', {
          params: { path: { roomId: roomId! }, query: { cursor: pageParam, limit: opts.pageSize ?? 100 } },
        }),
      ),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
  if (query.hasNextPage && !query.isFetchingNextPage && !query.isError) void query.fetchNextPage()
  return { ...query, items: flattenItems(query.data) }
}

export function flattenItems(data: ItemsCache | undefined): Item[] {
  return data?.pages.flatMap((p) => p.data) ?? []
}

// Insert or replace an item in a room's cached pages (used by mutations and the stream).
export function upsertCachedItem(queryClient: QueryClient, item: Item, opts: { keepReacted?: boolean } = {}) {
  queryClient.setQueryData<ItemsCache>(keys.items(item.roomId), (cache) => {
    if (!cache) return cache
    let found = false
    const pages = cache.pages.map((p) => ({
      ...p,
      data: p.data.map((existing) => {
        if (existing.id !== item.id) return existing
        found = true
        if (!opts.keepReacted) return item
        // Broadcast payloads carry reacted=false; keep this viewer's own state.
        const mine = new Set(existing.reactions.filter((r) => r.reacted).map((r) => r.type))
        return { ...item, reactions: item.reactions.map((r) => ({ ...r, reacted: mine.has(r.type) })) }
      }),
    }))
    if (!found) {
      const last = pages[pages.length - 1]
      if (last && !last.meta.hasMore) last.data = [...last.data, item].sort((a, b) => a.number - b.number)
    }
    return { ...cache, pages }
  })
  queryClient.setQueryData(keys.item(item.id), item)
}

export function useItem(itemId: string | undefined) {
  return useQuery({
    queryKey: keys.item(itemId ?? ''),
    enabled: !!itemId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/items/{itemId}', { params: { path: { itemId: itemId! } } })).data,
  })
}

export function useSendMessage(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: SendMessageInput) =>
      unwrap(await getApiClient().POST('/rooms/{roomId}/items', { params: { path: { roomId } }, body })).data,
    onSuccess: (item) => {
      upsertCachedItem(queryClient, item)
      queryClient.invalidateQueries({ queryKey: keys.room(roomId) })
    },
  })
}

export function useReplyToItem(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    // anchorStartMs (optional): the moment in the parent's media, captured when the user
    // chose REPLY HERE — not when they press Send.
    mutationFn: async ({ itemId, ...body }: ReplyToItemInput & { itemId: string }) =>
      unwrap(await getApiClient().POST('/items/{itemId}/replies', { params: { path: { itemId } }, body })).data,
    onSuccess: (item) => {
      upsertCachedItem(queryClient, item)
      queryClient.invalidateQueries({ queryKey: keys.room(roomId) })
    },
  })
}

// Places an existing Message (and its media) into more rooms. Returns only the newly
// created Items — rooms that already had the message are skipped server-side.
export function useShareMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ messageId, roomIds }: ShareMessageInput & { messageId: string }) =>
      unwrap(await getApiClient().POST('/messages/{messageId}/share', { params: { path: { messageId } }, body: { roomIds } })).data,
    onSuccess: (items) => {
      for (const item of items) {
        upsertCachedItem(queryClient, item)
        queryClient.invalidateQueries({ queryKey: keys.room(item.roomId) })
      }
      queryClient.invalidateQueries({ queryKey: keys.roomsAll })
    },
  })
}

export function useDeleteItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (itemId: string) =>
      unwrap(await getApiClient().DELETE('/items/{itemId}', { params: { path: { itemId } } })).data,
    onSuccess: (item) => upsertCachedItem(queryClient, item),
  })
}
