import { useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type { SendMessageInput, ShareMessageInput, Item, PaginatedMeta, ReplyToItemInput } from '../models'
import { keys } from './keys'

type ItemsPage = { data: Item[]; meta: PaginatedMeta }
export type ItemsCache = InfiniteData<ItemsPage>

// Fetch newest pages first, exposing only the loaded window in chronological order.
export function useRoomItems(roomId: string | undefined, opts: { pageSize?: number } = {}) {
  const query = useInfiniteQuery({
    queryKey: keys.items(roomId ?? ''),
    enabled: !!roomId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await getApiClient().GET('/rooms/{roomId}/items', {
          params: { path: { roomId: roomId! }, query: { cursor: pageParam, limit: opts.pageSize ?? 50, order: 'desc' } },
        }),
      ),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    // The stream (useRoomStream) keeps this cache live and replays changes after a dropped
    // connection. Refetching every page of every mounted room on tab focus is pure cost.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })
  const items = useMemo(() => flattenItems(query.data), [query.data])
  return { ...query, items }
}

export function flattenItems(data: ItemsCache | undefined): Item[] {
  const items = new Map<string, Item>()
  for (const page of data?.pages ?? []) {
    for (const item of page.data) if (!items.has(item.id)) items.set(item.id, item)
  }
  return [...items.values()].sort((a, b) => a.number - b.number)
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

    // The first page contains the newest items.
    for (let p = 0; p < pages.length; p++) {
      const at = pages[p]!.data.findIndex((existing) => existing.id === item.id)
      if (at < 0) continue
      const data = [...pages[p]!.data]
      data[at] = opts.keepReacted ? withOwnReactions(item, data[at]!) : item
      return replacePage(p, data)
    }

    // Events for unloaded older items must not expand the history window.
    const first = pages[0]
    if (!first) return cache
    const oldest = pages.at(-1)
    const oldestNumber = oldest?.data.reduce((min, entry) => Math.min(min, entry.number), Infinity) ?? Infinity
    if (oldest?.meta.hasMore && item.number < oldestNumber) return cache
    return replacePage(0, [...first.data, item].sort((a, b) => b.number - a.number))
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
