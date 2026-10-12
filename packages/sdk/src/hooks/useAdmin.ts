import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, getApiClient, unwrap } from '../client'
import type { components } from '../generated/types'

export type AdminUser = components['schemas']['AdminUser']
export type AdminUserDetail = components['schemas']['AdminUserDetail']
export type AdminUserChange = components['schemas']['AdminUserChange']
export function useAdminSession(enabled = true) {
  return useQuery({ queryKey: ['admin', 'session'], enabled, retry: false, staleTime: 0,
    queryFn: async () => unwrap(await getApiClient().GET('/admin/me')).data })
}
export function useAdminUsers(q: string, cursor?: string, enabled = true) {
  return useQuery({ queryKey: ['admin', 'users', q, cursor], enabled, retry: false,
    queryFn: async () => unwrap(await getApiClient().GET('/admin/users', { params: { query: { q: q || undefined, cursor } } })) })
}
export function useAdminUser(userId: string | null, enabled = true) {
  return useQuery({ queryKey: ['admin', 'user', userId], enabled: enabled && !!userId, retry: false,
    queryFn: async () => unwrap(await getApiClient().GET('/admin/users/{userId}', { params: { path: { userId: userId! } } })).data })
}
export function useAdminUserChange(csrfToken: string | null | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, ...body }: AdminUserChange & { userId: string }) => unwrap(await getApiClient().POST('/admin/users/{userId}/actions', {
      params: { path: { userId } }, body, headers: csrfToken ? { 'x-admin-csrf': csrfToken } : {},
    })).data,
    onError: (error) => { if (error instanceof ApiError && error.status === 409) void client.invalidateQueries({ queryKey: ['admin'] }) },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] })
      await client.invalidateQueries({ queryKey: ['entitlements'] })
    },
  })
}
export function useMyEntitlements(enabled = true) {
  return useQuery({ queryKey: ['entitlements'], enabled, retry: false, staleTime: 0, refetchInterval: 60_000,
    queryFn: async () => unwrap(await getApiClient().GET('/me/entitlements')).data })
}

export type AdminPreviewInput = components['schemas']['AdminUserPreviewInput']
export function useAdminChangePreview(userId: string, input: AdminPreviewInput | null, csrfToken?: string | null) {
  return useQuery({ queryKey: ['admin', 'preview', userId, input], enabled: !!input, retry: false, staleTime: 0,
    queryFn: async () => unwrap(await getApiClient().POST('/admin/users/{userId}/preview', {
      params: { path: { userId } }, body: input!, headers: csrfToken ? { 'x-admin-csrf': csrfToken } : {},
    })).data })
}
export function useAdminSubscriptions(status: components['schemas']['AdminSubscription']['status'] = 'all', cursor?: string, enabled = true) {
  return useQuery({ queryKey: ['admin', 'subscriptions', status, cursor], enabled, retry: false, staleTime: 30_000,
    queryFn: async () => unwrap(await getApiClient().GET('/admin/subscriptions', { params: { query: {
      status: status as 'all' | 'active' | 'trialing' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused', cursor,
    } } })) })
}

export function useAdminSettings(enabled = true) {
  return useQuery({ queryKey: ['admin', 'settings'], enabled, retry: false,
    queryFn: async () => unwrap(await getApiClient().GET('/admin/settings')).data })
}
export function useAdminStaffChange(csrfToken?: string | null) {
  const client = useQueryClient()
  return useMutation({ mutationFn: async ({userId, ...body}: components['schemas']['AdminStaffChange'] & {userId:string}) => unwrap(await getApiClient().POST('/admin/users/{userId}/staff', {params:{path:{userId}},body,headers:csrfToken?{'x-admin-csrf':csrfToken}:{}})).data,
    onSettled: () => client.invalidateQueries({queryKey:['admin']}) })
}
export function useAdminCustomerLink(csrfToken?: string | null) {
  const client = useQueryClient()
  return useMutation({ mutationFn: async ({userId, ...body}: components['schemas']['AdminCustomerLink'] & {userId:string}) => unwrap(await getApiClient().POST('/admin/users/{userId}/billing-customer', {params:{path:{userId}},body,headers:csrfToken?{'x-admin-csrf':csrfToken}:{}})).data,
    onSettled: () => client.invalidateQueries({queryKey:['admin']}) })
}
export function useAdminSubscriptionSync(csrfToken?: string | null) {
  const client = useQueryClient()
  return useMutation({ mutationFn: async ({subscriptionId, ...body}: components['schemas']['AdminSyncInput'] & {subscriptionId:string}) => unwrap(await getApiClient().POST('/admin/subscriptions/{subscriptionId}/sync', {params:{path:{subscriptionId}},body,headers:csrfToken?{'x-admin-csrf':csrfToken}:{}})).data,
    onSettled: async () => { await client.invalidateQueries({queryKey:['admin']}); await client.invalidateQueries({queryKey:['entitlements']}) } })
}

export function useAdminLiveCosts(enabled = true) {
  return useQuery({ queryKey: ['admin', 'live-costs'], enabled, retry: false,
    queryFn: async () => unwrap(await getApiClient().GET('/admin/live-costs')).data })
}
export function useAdminLiveStop(csrfToken?: string | null) {
  const client = useQueryClient()
  return useMutation({ mutationFn: async (body: components['schemas']['AdminLiveStop']) => unwrap(await getApiClient().POST('/admin/live-costs/stop', {body,headers:csrfToken?{'x-admin-csrf':csrfToken}:{}})).data,
    onSettled: () => client.invalidateQueries({queryKey:['admin','live-costs']}) })
}

export function useStaffMfa() {
  return useQuery({queryKey:['staff-mfa'],retry:false,staleTime:0,refetchInterval:30_000,
    queryFn:async()=>unwrap(await getApiClient().GET('/admin/mfa')).data})
}
export function useStaffMfaEnroll(csrf?:string|null) {
  return useMutation({mutationFn:async(password:string)=>unwrap(await getApiClient().POST('/admin/mfa/enroll',{body:{password},headers:csrf?{'x-admin-csrf':csrf}:{}})).data})
}
export function useStaffMfaVerify(csrf?:string|null) {
  return useMutation({mutationFn:async(code:string)=>unwrap(await getApiClient().POST('/admin/mfa/verify',{body:{code},headers:csrf?{'x-admin-csrf':csrf}:{}})).data})
}
