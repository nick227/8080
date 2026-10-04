import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import { keys } from './keys'

// Personal mute (doc/08 I5): global, enforced by the server. After a change, every
// loaded room refetches so muted items arrive content-less (or come back).
export function useMutes() {
  return useQuery({
    queryKey: keys.mutes,
    queryFn: async () => unwrap(await getApiClient().GET('/users/me/mutes')).data,
  })
}

export function useSetMute() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, muted }: { userId: string; muted: boolean }) => {
      const params = { params: { path: { userId } } }
      if (muted) unwrap(await getApiClient().PUT('/users/me/mutes/{userId}', params))
      else unwrap(await getApiClient().DELETE('/users/me/mutes/{userId}', params))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.mutes })
      void queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}

// Bots available to a room, and whether each is seated. Owner seats/kicks.
export function useRoomBots(roomId: string | undefined) {
  return useQuery({
    queryKey: keys.roomBots(roomId ?? ''),
    enabled: !!roomId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/rooms/{roomId}/bots', { params: { path: { roomId: roomId! } } })).data,
  })
}

export function useSetBotSeat(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, seated }: { userId: string; seated: boolean }) => {
      const params = { params: { path: { roomId, userId } } }
      return seated
        ? unwrap(await getApiClient().PUT('/rooms/{roomId}/bots/{userId}', params)).data
        : unwrap(await getApiClient().DELETE('/rooms/{roomId}/bots/{userId}', params)).data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.roomBots(roomId) })
      void queryClient.invalidateQueries({ queryKey: keys.participants(roomId) })
    },
  })
}
