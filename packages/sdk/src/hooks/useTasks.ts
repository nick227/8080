import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type { UpdateTaskStatusesInput, BulkTasksInput, CreateTaskInput, CreateWorkLogInput, ImportTasksInput, ImportWorkLogsInput, MoveTaskInput, UpdateTaskBoardInput, UpdateTaskInput } from '../models'
import { keys } from './keys'

// Calendar / Boards tasks. The web keeps an optimistic copy for drag-and-drop,
// so the writes are also exported as plain functions (`tasksApi`).

const path = (workspaceId: string) => ({ params: { path: { workspaceId } } })
const taskPath = (workspaceId: string, taskId: string) => ({ params: { path: { workspaceId, taskId } } })

export const tasksApi = {
  list: async (workspaceId: string) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/tasks', path(workspaceId))).data,
  create: async (workspaceId: string, body: CreateTaskInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/tasks', { ...path(workspaceId), body })).data,
  import: async (workspaceId: string, body: ImportTasksInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/tasks/import', { ...path(workspaceId), body })).data,
  update: async (workspaceId: string, taskId: string, body: UpdateTaskInput) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/tasks/{taskId}', { ...taskPath(workspaceId, taskId), body })).data,
  move: async (workspaceId: string, taskId: string, body: MoveTaskInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/tasks/{taskId}/move', { ...taskPath(workspaceId, taskId), body })).data,
  remove: async (workspaceId: string, taskId: string) => {
    unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/tasks/{taskId}', taskPath(workspaceId, taskId)))
  },
  restore: async (workspaceId: string, taskId: string) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/tasks/{taskId}/restore', taskPath(workspaceId, taskId))).data,
  block: async (workspaceId: string, taskId: string, reason: string) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/tasks/{taskId}/block', { ...taskPath(workspaceId, taskId), body: { reason } })).data,
  bulk: async (workspaceId: string, body: BulkTasksInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/tasks/bulk', { ...path(workspaceId), body })).data,
  unblock: async (workspaceId: string, taskId: string) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/tasks/{taskId}/unblock', taskPath(workspaceId, taskId))).data,
}

/** A task's history (recorded events, oldest first). */
export function useTaskActivity(workspaceId: string | undefined, taskId: string | undefined) {
  return useQuery({
    queryKey: keys.taskActivity(workspaceId ?? '', taskId ?? ''),
    enabled: !!workspaceId && !!taskId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/tasks/{taskId}/activity', taskPath(workspaceId!, taskId!))).data,
  })
}

export function useTasks(workspaceId: string | undefined, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: keys.tasks(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: () => tasksApi.list(workspaceId!),
    refetchInterval: opts.refetchInterval,
  })
}

export function useTaskComments(workspaceId: string | undefined, taskId: string | undefined) {
  return useQuery({
    queryKey: keys.taskComments(workspaceId ?? '', taskId ?? ''),
    enabled: !!workspaceId && !!taskId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/tasks/{taskId}/comments', taskPath(workspaceId!, taskId!))).data,
  })
}

export function useAddTaskComment(workspaceId: string, taskId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (text: string) =>
      unwrap(await getApiClient().POST('/workspaces/{workspaceId}/tasks/{taskId}/comments', { ...taskPath(workspaceId, taskId), body: { text } })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.taskComments(workspaceId, taskId) })
      void queryClient.invalidateQueries({ queryKey: keys.tasks(workspaceId) })
    },
  })
}

// Logged work ("Log work" on the calendar).
export const workLogsApi = {
  list: async (workspaceId: string) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/work-logs', path(workspaceId))).data,
  create: async (workspaceId: string, body: CreateWorkLogInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/work-logs', { ...path(workspaceId), body })).data,
  import: async (workspaceId: string, body: ImportWorkLogsInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/work-logs/import', { ...path(workspaceId), body })).data,
  remove: async (workspaceId: string, workLogId: string) => {
    unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/work-logs/{workLogId}', { params: { path: { workspaceId, workLogId } } }))
  },
}

export function useWorkLogs(workspaceId: string | undefined, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: keys.workLogs(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: () => workLogsApi.list(workspaceId!),
    refetchInterval: opts.refetchInterval,
  })
}

/** Board settings: WIP limits per column. */
export function useTaskBoard(workspaceId: string | undefined) {
  return useQuery({
    queryKey: keys.taskBoard(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/task-board', path(workspaceId!))).data,
  })
}

export function useUpdateTaskBoard(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpdateTaskBoardInput) =>
      unwrap(await getApiClient().PUT('/workspaces/{workspaceId}/task-board', { ...path(workspaceId), body })).data,
    onSuccess: (data) => queryClient.setQueryData(keys.taskBoard(workspaceId), data),
  })
}

/** A task's checklist (in order). Writes go through checklistApi; live updates refetch it. */
export function useTaskChecklist(workspaceId: string | undefined, taskId: string | undefined, opts: { paused?: boolean } = {}) {
  return useQuery({
    queryKey: keys.taskChecklist(workspaceId ?? '', taskId ?? ''),
    // Paused while the caller has writes in flight: a refetch then would show older state.
    enabled: !!workspaceId && !!taskId && !opts.paused,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/tasks/{taskId}/checklist', taskPath(workspaceId!, taskId!))).data,
  })
}

const itemPath = (workspaceId: string, taskId: string, itemId: string) => ({ params: { path: { workspaceId, taskId, itemId } } })

export const checklistApi = {
  add: async (workspaceId: string, taskId: string, body: { text: string; afterItemId?: string | null; beforeItemId?: string | null }) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/tasks/{taskId}/checklist', { ...taskPath(workspaceId, taskId), body })).data,
  update: async (workspaceId: string, taskId: string, itemId: string, body: { text?: string; done?: boolean; afterItemId?: string | null; beforeItemId?: string | null }) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/tasks/{taskId}/checklist/{itemId}', { ...itemPath(workspaceId, taskId, itemId), body })).data,
  remove: async (workspaceId: string, taskId: string, itemId: string) => {
    unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/tasks/{taskId}/checklist/{itemId}', itemPath(workspaceId, taskId, itemId)))
  },
}

/** The workspace's task workflow (statuses = board columns). */
export function useTaskStatuses(workspaceId: string | undefined) {
  return useQuery({
    queryKey: keys.taskStatuses(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/task-statuses', path(workspaceId!))).data,
  })
}

export function useUpdateTaskStatuses(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpdateTaskStatusesInput) =>
      unwrap(await getApiClient().PUT('/workspaces/{workspaceId}/task-statuses', { ...path(workspaceId), body })).data,
    onSuccess: (data) => queryClient.setQueryData(keys.taskStatuses(workspaceId), data),
  })
}

/** Board reports; refetched when tasks change (live) and on focus. */
export function useTaskReport(workspaceId: string | undefined, weeks: number) {
  return useQuery({
    queryKey: [...keys.tasks(workspaceId ?? ''), 'report', weeks],
    enabled: !!workspaceId,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/tasks/report', { ...path(workspaceId!), params: { path: { workspaceId: workspaceId! }, query: { weeks } } })).data,
    placeholderData: (previous) => previous,
  })
}
