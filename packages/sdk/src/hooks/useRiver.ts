import { useInfiniteQuery } from '@tanstack/react-query'
import { getApiClient } from '../client'
import { useSession } from './useAuth'

export function useRiver() {
  const session = useSession()

  return useInfiniteQuery({
    queryKey: ['river', session.data?.data.id],
    queryFn: async ({ pageParam }) => {
      const { data, error } = await getApiClient().GET('/river', {
        params: {
          query: {
            limit: 20,
            cursor: pageParam,
          },
        },
      })
      if (error) throw new Error((error as any).error ?? 'Failed to load river')
      return data
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor,
    enabled: !!session.data?.data.id,
  })
}
