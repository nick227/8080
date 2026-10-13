import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getApiBaseUrl, keys } from '@project/sdk'

/**
 * Near-real-time Work Session data outside the task surfaces: listens on the
 * workspace task stream and refetches everything under keys.work when a
 * teammate's clock changes. (Task surfaces get the same frame via useTaskSync.)
 */
export function useWorkStream(workspaceId: string | undefined) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!workspaceId || typeof EventSource === 'undefined') return
    const source = new EventSource(`${getApiBaseUrl()}/workspaces/${workspaceId}/tasks/stream`, { withCredentials: true })
    const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.work(workspaceId) })
    source.addEventListener('worksessions.changed', refresh)
    // A reconnect that couldn't replay may have missed changes (the first connect just loaded).
    let first = true
    source.addEventListener('ready', (e) => {
      if (!first && !JSON.parse((e as MessageEvent).data).replayed) refresh()
      first = false
    })
    source.addEventListener('reset', refresh)
    return () => source.close()
  }, [workspaceId, queryClient])
}
