import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, getApiClient, unwrap, type CompanyProfile, type UpdateCompanyProfileInput } from '@project/sdk'

export type { CompanyProfile }
export type ProfileChanges = UpdateCompanyProfileInput['changes']
export type FactKind = CompanyProfile['facts'][number]['kind']

/** The list fields the page edits, by the fact kind they store. */
export const LIST_KIND = {
  offerings: 'offering', customers: 'customer', differentiators: 'differentiator', goals: 'goal', links: 'link',
  competitors: 'competitor', challenges: 'challenge', terms: 'term', avoid: 'avoid',
} as const
export type ListField = keyof typeof LIST_KIND

/**
 * The company profile with one save per field (inline editing). Every save carries the
 * revision it started from; if someone else saved meanwhile, the profile reloads and the
 * edit is not applied (the person sees the newer value and can redo it).
 */
export function useCompanyProfile(workspaceId?: string | null) {
  const queryClient = useQueryClient()
  const key = ['company-profile', workspaceId ?? '']
  const [error, setError] = useState('')
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(workspaceId),
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/company-profile', { params: { path: { workspaceId: workspaceId! } } })).data as CompanyProfile,
  })

  const save = async (changes: ProfileChanges): Promise<boolean> => {
    const current = query.data
    if (!current || !workspaceId) return false
    setError('')
    try {
      const saved = unwrap(
        await getApiClient().PATCH('/workspaces/{workspaceId}/company-profile', {
          params: { path: { workspaceId } },
          body: { expectedRevision: current.revision, changes },
        }),
      ).data as CompanyProfile
      queryClient.setQueryData(key, saved)
      void queryClient.invalidateQueries({ queryKey: ['workspace-insights', workspaceId] })
      return true
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PROFILE_REVISION_CONFLICT') {
        await query.refetch()
        setError('Someone else just changed the profile. You’re seeing their version; make your edit again.')
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Only owners and admins can edit the company profile.')
      } else {
        setError(err instanceof Error ? err.message : 'Couldn’t save that change.')
      }
      return false
    }
  }

  const list = (field: ListField) => (query.data?.facts ?? []).filter((f) => f.kind === LIST_KIND[field])

  return { profile: query.data, loading: query.isLoading, failed: query.isError, retry: () => void query.refetch(), save, list, error, clearError: () => setError('') }
}
