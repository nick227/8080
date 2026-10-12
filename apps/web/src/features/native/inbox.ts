// The /native/ inbox: the caller's existing InboxItem rows. Two sources, one feed:
// each workspace's notices (tasks, contacts…) through the per-workspace inbox API, and
// the person's own conversation notices (/me/inbox: rooms belong to no workspace).
import { useMemo } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { ApiError, getApiClient, unwrap, type InboxItem, type MyInboxItem, type Workspace } from '@project/sdk'

/** What a notice is about, for the type filter. */
export type Kind = 'mention' | 'reply' | 'assigned' | 'blocked' | 'due' | 'message' | 'activity'

export const KINDS: { id: Kind; label: string }[] = [
  { id: 'mention', label: 'Mentions' },
  { id: 'reply', label: 'Replies' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'due', label: 'Due' },
  { id: 'message', label: 'Messages' },
  { id: 'activity', label: 'Activity' },
]

/** The feed key of the person's own (conversation) notices. */
export const ROOMS = 'rooms'

export type Notice = {
  id: string
  /** null: the person's own notice (a conversation). */
  workspaceId: string | null
  kind: Kind
  title: string
  summary: string
  /** Where it happened: the workspace's or the room's name. */
  place: string
  sourceType: string
  sourceId: string
  contactId: string | null
  unread: boolean
  createdAt: string
}

// Rows carry a structured type (server: taskNotices.ts, inboxAnnounce.ts).
const TASK_KINDS: Record<string, Kind> = { 'task.assigned': 'assigned', 'task.mention': 'mention', 'task.blocked': 'blocked', 'task.due': 'due' }

function workspaceKind(item: InboxItem): Kind {
  if (TASK_KINDS[item.type]) return TASK_KINDS[item.type]!
  // Rows written before notices had structured types (type "task" / "conversation").
  if (item.type === 'task') {
    if (item.dedupeKey.startsWith('due:')) return 'due'
    if (/ mentioned you /.test(item.title)) return 'mention'
    if (/ assigned you /.test(item.title)) return 'assigned'
    if (/ marked \S+ blocked$/.test(item.title)) return 'blocked'
  }
  if (item.sourceType === 'conversation') return 'message'
  return 'activity'
}

const fromWorkspace = (item: InboxItem, workspace: Workspace): Notice => ({
  id: item.id,
  workspaceId: workspace.id,
  kind: workspaceKind(item),
  title: item.title,
  summary: item.summary,
  place: workspace.name,
  sourceType: item.sourceType,
  sourceId: item.sourceId,
  contactId: item.action.contactId ?? null,
  unread: item.unread,
  createdAt: item.createdAt,
})

const fromPerson = (item: MyInboxItem): Notice => ({
  id: item.id,
  workspaceId: null,
  kind: item.type,
  title: item.title,
  summary: item.summary,
  place: item.sourceTitle,
  sourceType: item.sourceType,
  sourceId: item.sourceId,
  contactId: null,
  unread: item.unread,
  createdAt: item.createdAt,
})

const PAGE = 100 // the server's maximum page size
const REFRESH_MS = 20_000

// Workspace feeds live under ['workspaces', id, 'inbox'] so the main app's read/archive
// mutations and inbox stream refresh them too.
const feedKey = (key: string, unread: boolean) => (key === ROOMS ? ['me', 'inbox', { unread }] as const : ['workspaces', key, 'inbox', 'native', { unread }] as const)
/** Every key the app's feeds live under (refresh after a push). */
export const isFeedKey = (key: readonly unknown[]) => (key[0] === 'me' && key[1] === 'inbox') || (key[0] === 'workspaces' && key[2] === 'inbox')

async function fetchFeed(key: string, unread: boolean) {
  const query = unread ? { limit: PAGE, unread: true } : { limit: PAGE }
  if (key === ROOMS) return unwrap(await getApiClient().GET('/me/inbox', { params: { query } }))
  return unwrap(await getApiClient().GET('/workspaces/{workspaceId}/inbox', { params: { path: { workspaceId: key }, query } }))
}

export type Feed = {
  /** A workspace id, or ROOMS. */
  key: string
  label: string
  workspace: Workspace | null
  notices: Notice[]
  /** Unread ids (up to one page); `more` = there are further unread rows. */
  unread: { ids: string[]; more: boolean }
  /** Lost access since the workspace list loaded. */
  gone: boolean
  error: boolean
  loading: boolean
}

export function useUnifiedInbox(workspaces: Workspace[]) {
  const sources = useMemo(() => [{ key: ROOMS, label: 'Conversations', workspace: null as Workspace | null }, ...workspaces.map((w) => ({ key: w.id, label: w.name, workspace: w as Workspace | null }))], [workspaces])
  const queries = useQueries({
    queries: sources.flatMap((source) => [false, true].map((unread) => ({
      queryKey: feedKey(source.key, unread),
      queryFn: () => fetchFeed(source.key, unread),
      refetchInterval: REFRESH_MS,
      refetchOnWindowFocus: true,
      retry: (count: number, error: unknown) => !(error instanceof ApiError && (error.status === 404 || error.status === 401 || error.status === 403)) && count < 2,
    }))),
  })
  const stamp = queries.map((q) => q.dataUpdatedAt + ':' + q.errorUpdatedAt + ':' + q.status).join('|')
  return useMemo<Feed[]>(() => sources.map((source, i) => {
    const all = queries[i * 2]
    const unread = queries[i * 2 + 1]
    const gone = [all, unread].some((q) => q?.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403))
    const rows = (all?.data?.data ?? []) as (InboxItem | MyInboxItem)[]
    return {
      ...source,
      notices: source.workspace ? (rows as InboxItem[]).map((item) => fromWorkspace(item, source.workspace!)) : (rows as MyInboxItem[]).map(fromPerson),
      unread: { ids: unread?.data?.data.map((item) => item.id) ?? [], more: !!unread?.data?.meta.nextCursor },
      gone,
      error: !gone && !!(all?.isError || unread?.isError),
      loading: !!all?.isLoading,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` captures every query change
  }), [sources, stamp])
}

export type Mark = { workspaceId: string | null; id: string }

/** Optimistic read/unread for any notice; persisted through each source's own endpoint. */
export function useMarkRead() {
  const queryClient = useQueryClient()
  return async (marks: Mark[], unread = false) => {
    const touched = new Set(marks.map((m) => m.workspaceId ?? ROOMS))
    const ids = new Set(marks.map((m) => m.id))
    for (const key of touched) {
      await queryClient.cancelQueries({ queryKey: feedKey(key, false).slice(0, -1) })
      queryClient.setQueryData(feedKey(key, false), (page: { data: { id: string; unread: boolean }[] } | undefined) =>
        page && { ...page, data: page.data.map((item) => (ids.has(item.id) ? { ...item, unread } : item)) })
      queryClient.setQueryData(feedKey(key, true), (page: { data: { id: string }[] } | undefined) =>
        page && { ...page, data: unread ? page.data : page.data.filter((item) => !ids.has(item.id)) })
    }
    const results = await Promise.allSettled(marks.map(async (m) => {
      if (m.workspaceId === null) {
        return unwrap(await getApiClient().PATCH('/me/inbox/{inboxItemId}/read', { params: { path: { inboxItemId: m.id } }, body: { unread } }))
      }
      return unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/inbox/{inboxItemId}/read', {
        params: { path: { workspaceId: m.workspaceId, inboxItemId: m.id } },
        body: { unread },
      }))
    }))
    for (const key of touched) void queryClient.invalidateQueries({ queryKey: key === ROOMS ? ['me', 'inbox'] : ['workspaces', key, 'inbox'] })
    return results.every((r) => r.status === 'fulfilled')
  }
}
