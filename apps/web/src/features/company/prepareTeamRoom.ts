import type { QueryClient } from '@tanstack/react-query'
import { getApiClient, keys, unwrap } from '@project/sdk'

/** Resolve layout-critical data before replacing the company shell with its room. */
export async function prepareTeamRoom(client: QueryClient, roomId: string) {
  const api = getApiClient()
  const params = { path: { roomId } }
  await Promise.all([
    client.fetchQuery({ queryKey: keys.room(roomId), staleTime: 60_000,
      queryFn: async () => unwrap(await api.GET('/rooms/{roomId}', { params })).data }),
    client.fetchQuery({ queryKey: keys.roomCompany(roomId), staleTime: 60_000,
      queryFn: async () => unwrap(await api.GET('/rooms/{roomId}/company', { params })).data }),
    client.fetchQuery({ queryKey: keys.participants(roomId), staleTime: 60_000,
      queryFn: async () => unwrap(await api.GET('/rooms/{roomId}/participants', { params })).data }),
  ])
  // This is an already-resolved room ID, not a demo alias or invitation.
  client.setQueryData(['room-ref', roomId, null], roomId)
}
