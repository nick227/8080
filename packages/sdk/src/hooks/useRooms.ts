import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, getApiClient, unwrap } from '../client'
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

// Members + seated bots, one roster (doc/08 §2.3). Kept fresh by useRoomStream
// (participants.updated) — render every participant the same way.
export function useRoomParticipants(roomId: string | undefined) {
  return useQuery({
    queryKey: keys.participants(roomId ?? ''),
    enabled: !!roomId,
    staleTime: Infinity, // kept fresh by useRoomStream (participants.updated)
    queryFn: async () =>
      unwrap(await getApiClient().GET('/rooms/{roomId}/participants', { params: { path: { roomId: roomId! } } })).data,
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

export function useDeleteRoom() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (roomId: string) => {
      unwrap(await getApiClient().DELETE('/rooms/{roomId}', { params: { path: { roomId } } }))
      return roomId
    },
    onSuccess: (roomId) => {
      queryClient.removeQueries({ queryKey: keys.room(roomId) })
      queryClient.invalidateQueries({ queryKey: keys.roomsAll })
    },
  })
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

// Live video (LiveKit): a short-lived token for this room. Room access decides
// (404 otherwise); 503 LIVE_UNAVAILABLE when the server has no live video. A
// connected client is refreshed by LiveKit itself, so this only refetches when a
// room is (re)opened after it went stale.
export function useLiveToken(roomId: string | undefined) {
  return useQuery({
    queryKey: [...keys.room(roomId ?? ''), 'live-token'],
    enabled: !!roomId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: (count, error) => !(error instanceof ApiError && (error.status === 404 || error.status === 503)) && count < 2,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/rooms/{roomId}/live-token', { params: { path: { roomId: roomId! } } })).data,
  })
}
