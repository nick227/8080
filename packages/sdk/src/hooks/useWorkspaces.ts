import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type {
  CreateTeamInput,
  CreateWorkspaceInput,
  CreateWorkspaceInviteInput,
  TeamRole,
  UpdateTeamInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceMemberInput,
} from '../models'
import { keys } from './keys'

// Workspaces (doc/09 slice 0). Every workspace mutation also writes the activity
// timeline, so mutations invalidate the whole ['workspaces', id] subtree.

const path = (workspaceId: string) => ({ params: { path: { workspaceId } } })

function useWorkspaceMutation<V, R>(workspaceId: string, fn: (vars: V) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
    },
  })
}

// ─── workspaces ──────────────────────────────────────────────────────────────

export function useMyWorkspaces() {
  return useQuery({
    queryKey: keys.workspaces,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces')).data,
  })
}

export function useWorkspace(workspaceId: string | undefined) {
  return useQuery({
    queryKey: keys.workspace(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}', path(workspaceId!))).data,
  })
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateWorkspaceInput) => unwrap(await getApiClient().POST('/workspaces', { body })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workspaces })
    },
  })
}

export function useUpdateWorkspace(workspaceId: string) {
  return useWorkspaceMutation(workspaceId, async (body: UpdateWorkspaceInput) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}', { ...path(workspaceId), body })).data,
  )
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (workspaceId: string) => {
      unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}', path(workspaceId)))
      return workspaceId
    },
    onSuccess: (workspaceId) => {
      queryClient.removeQueries({ queryKey: keys.workspace(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: keys.workspaces, exact: true })
    },
  })
}

// ─── members and invites ─────────────────────────────────────────────────────

export function useWorkspaceMembers(workspaceId: string | undefined, params: { includeRemoved?: boolean } = {}) {
  return useQuery({
    queryKey: [...keys.workspaceMembers(workspaceId ?? ''), params],
    enabled: !!workspaceId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/members', { params: { path: { workspaceId: workspaceId! }, query: params } })).data,
  })
}

export function useUpdateWorkspaceMember(workspaceId: string) {
  return useWorkspaceMutation(workspaceId, async ({ memberId, ...body }: UpdateWorkspaceMemberInput & { memberId: string }) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/members/{memberId}', { params: { path: { workspaceId, memberId } }, body })).data,
  )
}

/** Removes a member, or leaves when it's the caller's own member id. */
export function useRemoveWorkspaceMember(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (memberId: string) => {
      unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/members/{memberId}', { params: { path: { workspaceId, memberId } } }))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: keys.workspaces, exact: true })
    },
  })
}

export function useWorkspaceInvites(workspaceId: string | undefined) {
  return useQuery({
    queryKey: keys.workspaceInvites(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/invites', path(workspaceId!))).data,
  })
}

/** Resolves to `{ data: invite, token }` — the token is only ever returned here. */
export function useCreateWorkspaceInvite(workspaceId: string) {
  return useWorkspaceMutation(workspaceId, async (body: CreateWorkspaceInviteInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/invites', { ...path(workspaceId), body })),
  )
}

export function useRevokeWorkspaceInvite(workspaceId: string) {
  return useWorkspaceMutation(workspaceId, async (inviteId: string) => {
    unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/invites/{inviteId}', { params: { path: { workspaceId, inviteId } } }))
  })
}

export function useAcceptWorkspaceInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) => unwrap(await getApiClient().POST('/workspace-invites/accept', { body: { token } })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workspaces })
    },
  })
}

// ─── teams ───────────────────────────────────────────────────────────────────

export function useTeams(workspaceId: string | undefined, params: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: [...keys.teams(workspaceId ?? ''), params],
    enabled: !!workspaceId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/teams', { params: { path: { workspaceId: workspaceId! }, query: params } })).data,
  })
}

/** Pass an idempotencyKey (e.g. one per form submission) to make retries safe. */
export function useCreateTeam(workspaceId: string) {
  return useWorkspaceMutation(workspaceId, async ({ idempotencyKey, ...body }: CreateTeamInput & { idempotencyKey?: string }) =>
    unwrap(
      await getApiClient().POST('/workspaces/{workspaceId}/teams', {
        params: { path: { workspaceId }, header: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} },
        body,
      }),
    ).data,
  )
}

export function useUpdateTeam(workspaceId: string) {
  return useWorkspaceMutation(workspaceId, async ({ teamId, ...body }: UpdateTeamInput & { teamId: string }) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/teams/{teamId}', { params: { path: { workspaceId, teamId } }, body })).data,
  )
}

/** Adds the member to the team, or changes their team role; `role: null` removes them. */
export function useSetTeamMember(workspaceId: string) {
  return useWorkspaceMutation(workspaceId, async ({ teamId, memberId, role }: { teamId: string; memberId: string; role: TeamRole | null }) => {
    const params = { params: { path: { workspaceId, teamId, memberId } } }
    return role === null
      ? unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/teams/{teamId}/members/{memberId}', params)).data
      : unwrap(await getApiClient().PUT('/workspaces/{workspaceId}/teams/{teamId}/members/{memberId}', { ...params, body: { role } })).data
  })
}

// ─── timeline and audit ──────────────────────────────────────────────────────

export function useWorkspaceActivity(workspaceId: string | undefined, params: { limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: keys.workspaceActivity(workspaceId ?? ''),
    enabled: !!workspaceId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await getApiClient().GET('/workspaces/{workspaceId}/activity', {
          params: { path: { workspaceId: workspaceId! }, query: { ...params, cursor: pageParam } },
        }),
      ),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
}

/** Audit log (owner/admin). */
export function useWorkspaceActions(workspaceId: string | undefined, params: { limit?: number; targetType?: string; targetId?: string } = {}) {
  return useInfiniteQuery({
    queryKey: keys.workspaceActions(workspaceId ?? '', params),
    enabled: !!workspaceId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await getApiClient().GET('/workspaces/{workspaceId}/actions', {
          params: { path: { workspaceId: workspaceId! }, query: { ...params, cursor: pageParam } },
        }),
      ),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
}
