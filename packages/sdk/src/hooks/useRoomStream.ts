import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getApiBaseUrl, getApiClient } from '../client'
import type { StreamEvent } from '../models'
import { keys } from './keys'
import { upsertCachedItem } from './useItems'

// Live room updates over SSE, merged into the useRoomItems cache.
// onEvent lets apps with their own store (e.g. zustand) mirror events too.
export function useRoomStream(roomId: string | undefined, opts: { onEvent?: (event: StreamEvent) => void } = {}) {
  const queryClient = useQueryClient()
  const { onEvent } = opts

  useEffect(() => {
    if (!roomId || typeof EventSource === 'undefined') return
    const source = new EventSource(`${getApiBaseUrl()}/rooms/${roomId}/stream`, { withCredentials: true })
    let dropped = false
    const pendingFetches = new Map<string, ReturnType<typeof setTimeout>>()

    const handle = (message: MessageEvent<string>) => {
      let event: StreamEvent
      try {
        event = JSON.parse(message.data)
      } catch {
        return
      }

      // Debounce rapid events for the same item (e.g. multiple reactions in <100ms)
      // to avoid race conditions and redundant DB queries.
      const timer = pendingFetches.get(event.itemId)
      if (timer) clearTimeout(timer)

      pendingFetches.set(
        event.itemId,
        setTimeout(async () => {
          pendingFetches.delete(event.itemId)
          try {
            const res = await queryClient.fetchQuery({
              queryKey: keys.item(event.itemId),
              queryFn: () => getApiClient().GET('/items/{itemId}', { params: { path: { itemId: event.itemId } } }),
              staleTime: 0, // Always fetch, but dedupes if multiple concurrent fetchQuery happen
            })
            if (res.data?.data) {
              upsertCachedItem(queryClient, res.data.data, { keepReacted: true })
            }
          } catch (e) {
            // Ignore fetch errors
          }
        }, 100)
      )

      onEvent?.(event)
    }

    source.addEventListener('item.created', handle as EventListener)
    source.addEventListener('item.updated', handle as EventListener)
    // Someone arrived/left, or a bot was seated/kicked: refetch the roster.
    const roster = () => queryClient.invalidateQueries({ queryKey: keys.participants(roomId) })
    source.addEventListener('participants.updated', roster)
    source.onerror = () => {
      dropped = true
    }
    source.onopen = () => {
      // Refresh a bounded recent window until durable change-cursor recovery exists.
      if (dropped) {
        void queryClient.resetQueries({ queryKey: keys.items(roomId), exact: true })
        roster()
      }
      dropped = false
    }
    return () => {
      source.close()
      pendingFetches.forEach(clearTimeout)
      pendingFetches.clear()
    }
  }, [roomId, queryClient, onEvent])
}
