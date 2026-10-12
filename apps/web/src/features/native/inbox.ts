// The /native/ inbox: the caller's existing InboxItem rows, read across every
// workspace they belong to through the per-workspace inbox API. No new event model.
import { useMemo } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { ApiError, getApiClient, unwrap, type InboxItem, type Workspace } from '@project/sdk'

/** What a notice is about, for the type filter. Derived from the row, never stored. */
export type Kind = 'mention' | 'assigned' | 'blocked' | 'due' | 'message' | 'activity'

export const KINDS: { id: Kind; label: string }[] = [
  { id: 'mention', label: 'Mentions' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'due', label: 'Due' },
  { id: 'message', label: 'Messages' },
  { id: 'activity', label: 'Activity' },
]

// Task notice titles are written in taskNotices.ts / taskReminders.ts.
export function kindOf(item: InboxItem): Kind {
  if (item.sourceType === 'task') {
    if (item.dedupeKey.startsWith('due:')) return 'due'
    if (/ mentioned you /.test(item.title)) return 'mention'
    if (/ assigned you /.test(item.title)) return 'assigned'
    if (/ marked \S+ blocked$/.test(item.title)) return 'blocked'
    return 'activity'
  }
  if (item.sourceType === 'conversation') return 'message'
  return 'activity'
}

const PAGE = 100 // the server's maximum page size
const REFRESH_MS = 20_000

// Under ['workspaces', id, 'inbox'] so the main app's read/archive mutations and
// inbox stream refresh these too.
const feedKey = (workspaceId: string, unread: boolean) => ['workspaces', workspaceId, 'inbox', 'native', { unread }] as const

async function fetchInbox(workspaceId: string, unread: boolean) {
  const query = unread ? { limit: PAGE, unread: true } : { limit: PAGE }
  return unwrap(await getApiClient().GET('/workspaces/{workspaceId}/inbox', { params: { path: { workspaceId }, query } }))
}

export type WorkspaceInbox = {
  workspace: Workspace
  items: InboxItem[]
  /** Unread ids (up to one page); `more` = there are further unread rows. */
  unread: { ids: string[]; more: boolean }
  /** Lost access since the workspace list loaded. */
  gone: boolean
  error: boolean
  loading: boolean
}

export function useUnifiedInbox(workspaces: Workspace[]) {
  const queries = useQueries({
    queries: workspaces.flatMap((w) => [false, true].map((unread) => ({
      queryKey: feedKey(w.id, unread),
      queryFn: () => fetchInbox(w.id, unread),
      refetchInterval: REFRESH_MS,
      refetchOnWindowFocus: true,
      retry: (count: number, error: unknown) => !(error instanceof ApiError && (error.status === 404 || error.status === 401 || error.status === 403)) && count < 2,
    }))),
  })
  const stamp = queries.map((q) => q.dataUpdatedAt + ':' + q.errorUpdatedAt + ':' + q.status).join('|')
  return useMemo<WorkspaceInbox[]>(() => workspaces.map((workspace, i) => {
    const all = queries[i * 2]
    const unread = queries[i * 2 + 1]
    const gone = [all, unread].some((q) => q?.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403))
    return {
      workspace,
      items: all?.data?.data ?? [],
      unread: { ids: unread?.data?.data.map((item) => item.id) ?? [], more: !!unread?.data?.meta.nextCursor },
      gone,
      error: !gone && !!(all?.isError || unread?.isError),
      loading: !!all?.isLoading,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` captures every query change
  }), [workspaces, stamp])
}

/** Optimistic read/unread for any workspace's row; persisted through the existing endpoint. */
export function useMarkRead() {
  const queryClient = useQueryClient()
  return async (marks: { workspaceId: string; inboxItemId: string }[], unread = false) => {
    const touched = new Set(marks.map((m) => m.workspaceId))
    const ids = new Set(marks.map((m) => m.inboxItemId))
    for (const workspaceId of touched) {
      await queryClient.cancelQueries({ queryKey: ['workspaces', workspaceId, 'inbox', 'native'] })
      queryClient.setQueryData(feedKey(workspaceId, false), (page: { data: InboxItem[] } | undefined) =>
        page && { ...page, data: page.data.map((item) => (ids.has(item.id) ? { ...item, unread } : item)) })
      queryClient.setQueryData(feedKey(workspaceId, true), (page: { data: InboxItem[] } | undefined) =>
        page && { ...page, data: unread ? page.data : page.data.filter((item) => !ids.has(item.id)) })
    }
    const results = await Promise.allSettled(marks.map((m) =>
      getApiClient().PATCH('/workspaces/{workspaceId}/inbox/{inboxItemId}/read', {
        params: { path: { workspaceId: m.workspaceId, inboxItemId: m.inboxItemId } },
        body: { unread },
      }).then(unwrap)))
    for (const workspaceId of touched) void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'inbox'] })
    return results.every((r) => r.status === 'fulfilled')
  }
}
