import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import { upsertCachedItem } from './useItems'

// Answer a bot message's choice (doc/12 §4). First choice wins; repeating it is a
// no-op. The bot's follow-up arrives through the room stream as a new item.
export function useChooseOption() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemId, optionIds }: { itemId: string; optionIds: string[] }) =>
      unwrap(await getApiClient().POST('/items/{itemId}/choice', { params: { path: { itemId } }, body: { optionIds } })).data,
    onSuccess: (item) => upsertCachedItem(queryClient, item),
  })
}
