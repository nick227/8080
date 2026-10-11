import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type {
  BudgetCategory,
  BudgetDirection,
  BudgetItem,
  BudgetStatus,
  BudgetSummary,
  CreateBudgetItemInput,
  ImportBudgetItemsInput,
  PaginatedBudgetResponse,
  UpdateBudgetItemInput,
} from '../models'
import { keys } from './keys'

export type BudgetQueryParams = {
  direction?: BudgetDirection
  category?: BudgetCategory
  status?: BudgetStatus
  scheduledDate?: string
  from?: string
  to?: string
  search?: string
  sort?: 'date' | 'amount' | 'title' | 'created'
  dir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export function useBudgetItems(workspaceId: string | undefined, params: BudgetQueryParams = {}) {
  return useQuery<PaginatedBudgetResponse>({
    queryKey: keys.budget(workspaceId ?? '', params),
    enabled: !!workspaceId,
    queryFn: async () =>
      unwrap(
        await getApiClient().GET('/workspaces/{workspaceId}/budget', {
          params: { path: { workspaceId: workspaceId! }, query: params as any },
        }),
      ),
  })
}

export function useBudgetSummary(workspaceId: string | undefined) {
  return useQuery<BudgetSummary>({
    queryKey: keys.budgetSummary(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: async () =>
      unwrap(
        await getApiClient().GET('/workspaces/{workspaceId}/budget/summary', {
          params: { path: { workspaceId: workspaceId! } },
        }),
      ).data,
  })
}

export function useBudgetItem(workspaceId: string | undefined, budgetItemId: string | undefined) {
  return useQuery<BudgetItem>({
    queryKey: keys.budgetItem(workspaceId ?? '', budgetItemId ?? ''),
    enabled: !!workspaceId && !!budgetItemId,
    queryFn: async () =>
      unwrap(
        await getApiClient().GET('/workspaces/{workspaceId}/budget/{budgetItemId}', {
          params: { path: { workspaceId: workspaceId!, budgetItemId: budgetItemId! } },
        }),
      ).data,
  })
}

export function useCreateBudgetItem(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateBudgetItemInput) =>
      unwrap(
        await getApiClient().POST('/workspaces/{workspaceId}/budget', {
          params: { path: { workspaceId } },
          body,
        }),
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'budget'] })
    },
  })
}

/** CSV import: all rows or none; reuse the idempotencyKey when retrying the same file. */
export function useImportBudgetItems(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: ImportBudgetItemsInput) =>
      unwrap(
        await getApiClient().POST('/workspaces/{workspaceId}/budget/import', {
          params: { path: { workspaceId } },
          body,
        }),
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'budget'] })
    },
  })
}

export function useUpdateBudgetItem(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ budgetItemId, body }: { budgetItemId: string; body: UpdateBudgetItemInput }) =>
      unwrap(
        await getApiClient().PATCH('/workspaces/{workspaceId}/budget/{budgetItemId}', {
          params: { path: { workspaceId, budgetItemId } },
          body,
        }),
      ).data,
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'budget'] })
      void queryClient.invalidateQueries({ queryKey: keys.budgetItem(workspaceId, vars.budgetItemId) })
    },
  })
}

export function useDeleteBudgetItem(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (budgetItemId: string) =>
      unwrap(
        await getApiClient().DELETE('/workspaces/{workspaceId}/budget/{budgetItemId}', {
          params: { path: { workspaceId, budgetItemId } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'budget'] })
    },
  })
}
