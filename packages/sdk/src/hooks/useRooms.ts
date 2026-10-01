import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type { CreateRoomInput, Room, UpdateRoomInput } from '../models'
import { keys } from './keys'

export function useRooms(params: { q?: string; topic?: string; limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: keys.rooms(params),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(await getApiClient().GET('/rooms', { params: { query: { ...params, cursor: pageParam } } })),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
}

export function useMyRooms(params: { limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: keys.myRooms,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(await getApiClient().GET('/rooms/mine', { params: { query: { ...params, cursor: pageParam } } })),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
}

export function useRoom(roomId: string | undefined) {
  return useQuery({
    queryKey: keys.room(roomId ?? ''),
    enabled: !!roomId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/rooms/{roomId}', { params: { path: { roomId: roomId! } } })).data,
  })
}

function useRoomMutation<V>(fn: (vars: V) => Promise<Room>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (room) => {
      queryClient.setQueryData(keys.room(room.id), room)
      queryClient.invalidateQueries({ queryKey: keys.roomsAll })
    },
  })
}

export function useCreateRoom() {
  return useRoomMutation(async (body: CreateRoomInput) => unwrap(await getApiClient().POST('/rooms', { body })).data)
}

export function useUpdateRoom(roomId: string) {
  return useRoomMutation(
    async (body: UpdateRoomInput) =>
      unwrap(await getApiClient().PATCH('/rooms/{roomId}', { params: { path: { roomId } }, body })).data,
  )
}

// Pass inviteCode for private rooms (from a /room/:id?invite=CODE link).
export function useJoinRoom() {
  return useRoomMutation(
    async ({ roomId, inviteCode }: { roomId: string; inviteCode?: string }) =>
      unwrap(
        await getApiClient().POST('/rooms/{roomId}/join', {
          params: { path: { roomId } },
          body: inviteCode ? { inviteCode } : {},
        }),
      ).data,
  )
}

export function useLeaveRoom() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (roomId: string) => {
      unwrap(await getApiClient().DELETE('/rooms/{roomId}/members/me', { params: { path: { roomId } } }))
      return roomId
    },
    onSuccess: (roomId) => {
      queryClient.invalidateQueries({ queryKey: keys.room(roomId) })
      queryClient.invalidateQueries({ queryKey: keys.roomsAll })
    },
  })
}

export function useRotateInviteCode(roomId: string) {
  return useRoomMutation(
    async (_: void) =>
      unwrap(await getApiClient().POST('/rooms/{roomId}/invite-code', { params: { path: { roomId } } })).data,
  )
}
