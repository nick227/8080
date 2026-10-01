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
    // The stream (useRoomStream) keeps this cache live and refetches after a dropped
    // connection. Refetching every page of every mounted room on tab focus is pure cost.
    refetchOnWindowFocus: false,
  })
  if (query.hasNextPage && !query.isFetchingNextPage && !query.isError) void query.fetchNextPage()
  return { ...query, items: flattenItems(query.data) }
}

export function flattenItems(data: ItemsCache | undefined): Item[] {
  return data?.pages.flatMap((p) => p.data) ?? []
}

// Broadcast payloads carry reacted=false; keep this viewer's own state.
function withOwnReactions(item: Item, existing: Item): Item {
  const mine = new Set(existing.reactions.filter((r) => r.reacted).map((r) => r.type))
  return { ...item, reactions: item.reactions.map((r) => ({ ...r, reacted: mine.has(r.type) })) }
}

// Insert or replace an item in a room's cached pages (used by mutations and the stream).
// Copies only the page that changes, so every other page and item keeps its identity.
export function upsertCachedItem(queryClient: QueryClient, item: Item, opts: { keepReacted?: boolean } = {}) {
  queryClient.setQueryData<ItemsCache>(keys.items(item.roomId), (cache) => {
    if (!cache) return cache
    const pages = cache.pages
    const replacePage = (index: number, data: Item[]) => {
      const next = [...pages]
      next[index] = { ...pages[index]!, data }
      return { ...cache, pages: next }
    }

    // Recent items (the usual update) live in the last pages: search from the end.
    for (let p = pages.length - 1; p >= 0; p--) {
      const at = pages[p]!.data.findIndex((existing) => existing.id === item.id)
      if (at < 0) continue
      const data = [...pages[p]!.data]
      data[at] = opts.keepReacted ? withOwnReactions(item, data[at]!) : item
      return replacePage(p, data)
    }

    // New item: append once every page is loaded; while still paging, a later page brings it.
    const lastIndex = pages.length - 1
    const last = pages[lastIndex]
    if (!last || last.meta.hasMore) return cache
    const tail = last.data[last.data.length - 1]
    const data = !tail || tail.number < item.number
      ? [...last.data, item]
      : [...last.data, item].sort((a, b) => a.number - b.number)
    return replacePage(lastIndex, data)
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
