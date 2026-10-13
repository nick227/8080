import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type { AddWorkTimeInput, CorrectWorkSegmentInput, StopWorkSessionInput, WorkUpdateInput } from '../models'
import { keys } from './keys'

// Work Session: the time clock + team lobby. Nothing ticks on the server; the
// client derives running time from `runningSince`. Live changes arrive on the
// task stream as `worksessions.changed` (invalidate keys.work).

const path = (workspaceId: string) => ({ params: { path: { workspaceId } } })

export function useWorkLobby(workspaceId: string | undefined, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: keys.workLobby(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/work-sessions/lobby', path(workspaceId!))).data,
    refetchInterval: opts.refetchInterval,
  })
}

/** Recorded time per task (all tasks, or one). */
export function useWorkTime(workspaceId: string | undefined, taskId?: string) {
  return useQuery({
    queryKey: keys.workTime(workspaceId ?? '', taskId),
    enabled: !!workspaceId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/work-time', { params: { path: { workspaceId: workspaceId! }, query: taskId ? { taskId } : {} } })),
    staleTime: 30_000,
  })
}

/** Sessions overlapping [from, to): the Calendar's actual time. */
export function useWorkSessions(workspaceId: string | undefined, range: { from: string; to: string; memberId?: string; taskId?: string } | null) {
  return useQuery({
    queryKey: keys.workSessions(workspaceId ?? '', range?.from ?? '', range?.to ?? '', range?.memberId, range?.taskId),
    enabled: !!workspaceId && !!range,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/work-sessions', { params: { path: { workspaceId: workspaceId! }, query: range! } })).data,
    staleTime: 30_000,
  })
}

export const workSessionApi = {
  start: async (workspaceId: string, taskId: string | null) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/work-sessions', { ...path(workspaceId), body: { taskId } })).data,
  pause: async (workspaceId: string) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/work-sessions/current/pause', path(workspaceId))).data,
  resume: async (workspaceId: string, taskId?: string | null) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/work-sessions/current/resume', { ...path(workspaceId), body: taskId === undefined ? {} : { taskId } })).data,
  switchTask: async (workspaceId: string, taskId: string | null) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/work-sessions/current/switch', { ...path(workspaceId), body: { taskId } })).data,
  stop: async (workspaceId: string, body: StopWorkSessionInput = {}) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/work-sessions/current/stop', { ...path(workspaceId), body })).data,
  update: async (workspaceId: string, body: WorkUpdateInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/work-updates', { ...path(workspaceId), body })).data,
  correct: async (workspaceId: string, segmentId: string, body: CorrectWorkSegmentInput) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/work-segments/{segmentId}', { params: { path: { workspaceId, segmentId } }, body })).data,
  addTime: async (workspaceId: string, body: AddWorkTimeInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/work-segments', { ...path(workspaceId), body })).data,
}

/** Any clock action; on success everything Work Session-shaped refetches (lobby, task time, calendar). */
export function useWorkAction<A extends unknown[], R>(workspaceId: string | undefined, run: (workspaceId: string, ...args: A) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: A) => run(workspaceId!, ...args),
    onSettled: () => {
      if (!workspaceId) return
      void queryClient.invalidateQueries({ queryKey: keys.work(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: keys.workLogs(workspaceId) })
    },
  })
}
