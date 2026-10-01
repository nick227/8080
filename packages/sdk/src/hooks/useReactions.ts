import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type { ReactionType } from '../models'
import { upsertCachedItem } from './useItems'

// on=true adds the caller's reaction, on=false removes it. Both are idempotent.
export function useSetReaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemId, type, on }: { itemId: string; type: ReactionType; on: boolean }) => {
      const opts = { params: { path: { itemId, type } } }
      const client = getApiClient()
      return unwrap(
        on
          ? await client.PUT('/items/{itemId}/reactions/{type}', opts)
          : await client.DELETE('/items/{itemId}/reactions/{type}', opts),
      ).data
    },
    onSuccess: (item) => upsertCachedItem(queryClient, item),
  })
}
