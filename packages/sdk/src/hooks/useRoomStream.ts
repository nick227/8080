import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getApiBaseUrl } from '../client'
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

    const handle = (message: MessageEvent<string>) => {
      let event: StreamEvent
      try {
        event = JSON.parse(message.data)
      } catch {
        return
      }
      // Broadcast payloads always carry reacted=false, so keep this viewer's cached
      // flags — including for their own actions, whose mutation response sets them.
      upsertCachedItem(queryClient, event.item, { keepReacted: true })
      onEvent?.(event)
    }

    source.addEventListener('item.created', handle as EventListener)
    source.addEventListener('item.updated', handle as EventListener)
    source.onerror = () => {
      dropped = true
    }
    source.onopen = () => {
      // Catch up on anything missed while disconnected.
      if (dropped) queryClient.invalidateQueries({ queryKey: keys.items(roomId) })
      dropped = false
    }
    return () => source.close()
  }, [roomId, queryClient, onEvent])
}
