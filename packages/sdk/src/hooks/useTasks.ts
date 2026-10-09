import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type { CreateTaskInput, ImportTasksInput, MoveTaskInput, UpdateTaskInput } from '../models'
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
