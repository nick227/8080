import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getApiClient, ApiError } from '../client'
import type { GuestInput, LoginInput, RegisterInput } from '../models'

export function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data, error, response } = await getApiClient().GET('/auth/me')
      if (error) throw new ApiError(response.status, (error as any).error)
      return data!
    },
    retry: false,
    staleTime: 60_000,
  })
}

// App bootstrap: resolves the current user, starting a guest session if there is
// none. POST /auth/guest is idempotent (reuses a valid session cookie), so this is
// safe to mount once at the root and gate rendering on. Shares the ['me'] key.
export function useSession() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data, error, response } = await getApiClient().POST('/auth/guest', { body: {} })
      if (error) throw new ApiError(response.status, (error as any).error)
      return data!
    },
    staleTime: Infinity,
    retry: 1,
  })
}

// Guest-first identity: call once when useCurrentUser() 401s.
export function useGuestSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: GuestInput = {}) => {
      const { data, error, response } = await getApiClient().POST('/auth/guest', { body })
      if (error) throw new ApiError(response.status, (error as any).error)
      return data!
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
    },
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: LoginInput) => {
      const { data, error, response } = await getApiClient().POST('/auth/login', { body })
      if (error) throw new ApiError(response.status, (error as any).error)
      return data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

// Upgrades the current guest in place when a guest session is present.
export function useRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: RegisterInput) => {
      const { data, error, response } = await getApiClient().POST('/auth/register', { body })
      if (error) throw new ApiError(response.status, (error as any).error)
      return data!
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await getApiClient().POST('/auth/logout')
      if (error) throw new ApiError(response.status, (error as any).error)
    },
    onSuccess: () => {
      queryClient.clear()
    },
  })
}
