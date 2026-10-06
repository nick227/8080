import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getApiBaseUrl } from '../client'
import type { StreamEvent } from '../models'
import { keys } from './keys'
import { upsertCachedItem, type ItemsCache } from './useItems'

// The cursor lives with the loaded pages: remounts resume without losing history.
export function useRoomStream(roomId: string | undefined, opts: { onEvent?: (event: StreamEvent) => void } = {}) {
  const queryClient = useQueryClient()
  const { onEvent } = opts
  useEffect(() => {
    if (!roomId || typeof EventSource === 'undefined') return
    let source: EventSource | undefined
    let cursor = -1
    let flushing = false
    const pending: StreamEvent[] = []
    const flush = () => {
      if (flushing || queryClient.getQueryState(keys.items(roomId))?.fetchStatus === 'fetching') return
      flushing = true
      try {
        for (const event of pending.splice(0)) {
          const next = Number(event.cursor)
          if (next <= cursor) continue
          upsertCachedItem(queryClient, event.item)
          cursor = next
          queryClient.setQueryData<ItemsCache>(keys.items(roomId), cache => {
            if (!cache?.pages[0]) return cache
            const pages = [...cache.pages]
            pages[0] = { ...pages[0]!, meta: { ...pages[0]!.meta, changeCursor: event.cursor } }
            return { ...cache, pages }
          })
          onEvent?.(event)
        }
      } finally { flushing = false }
    }
    const start = () => {
      if (source) return
      const cache = queryClient.getQueryData<ItemsCache>(keys.items(roomId))
      const initial = cache?.pages[0]?.meta.changeCursor
      if (initial === undefined) return
      cursor = Number(initial)
      source = new EventSource(`${getApiBaseUrl()}/rooms/${roomId}/stream?cursor=${encodeURIComponent(initial)}`, { withCredentials: true })
      const handle = (message: MessageEvent<string>) => {
        let event: StreamEvent
        try { event = JSON.parse(message.data) } catch { return }
        const next = Number(event.cursor)
        if (!event.item || event.item.roomId !== roomId || !Number.isSafeInteger(next) || next <= cursor) return
        pending.push(event)
        flush()
      }
      source.addEventListener('item.created', handle as EventListener)
      source.addEventListener('item.updated', handle as EventListener)
      const roster = () => { void queryClient.invalidateQueries({ queryKey: keys.participants(roomId) }) }
      source.addEventListener('participants.updated', roster)
      // First open: the query already holds a fresh roster. Re-sync only on reconnect.
      let opened = false
      source.onopen = () => { if (opened) roster(); opened = true }
    }
    const unsubscribe = queryClient.getQueryCache().subscribe(() => { start(); flush() })
    start()
    return () => { unsubscribe(); source?.close() }
  }, [roomId, queryClient, onEvent])
}
