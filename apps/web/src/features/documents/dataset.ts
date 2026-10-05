import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, documentDatasetsApi, getApiClient, keys, unwrap } from '@project/sdk'

// Connected datasets for the grid (doc/10 §7A, §8). Rows are the canonical
// records read through the server's dataset contract — never a copy kept here —
// and an edit is a versioned command on the record itself. Freshness: every
// view refetches on focus and every few seconds, and a successful write nudges
// other tabs at once. Saved-view configuration stays in the document.

export type DatasetColumn = {
  key: string
  label: string
  type: 'text' | 'number'
  editable: boolean
  // The server dataset column behind this grid column
  field: 'displayName' | 'title' | 'primaryEmail'
}

export type DatasetRow = {
  id: string
  version: number
  cells: Record<string, string>
}

export type EditInput = {
  rowId: string
  field: string
  value: string
  expectedVersion: number
  idempotencyKey: string
  sourceDocumentId: string
}

export type EditResult =
  | { status: 'updated'; row: DatasetRow }
  | { status: 'conflict'; current: DatasetRow | null; proposed: string }
  | { status: 'failed'; message: string }

export type DatasetDefinition = {
  key: string
  version: number
  description: string
  rowGrain: string
  columns: DatasetColumn[]
}

// Name and job write through to the contact; email is derived from the contact's
// addresses (doc/09 §4.1), so it is read-only here.
export const contactsDataset: DatasetDefinition = {
  key: 'contacts',
  version: 1,
  description: 'Live contacts',
  rowGrain: 'contact',
  columns: [
    { key: 'name', label: 'Name', type: 'text', editable: true, field: 'displayName' },
    { key: 'title', label: 'Job', type: 'text', editable: true, field: 'title' },
    { key: 'email', label: 'Email', type: 'text', editable: false, field: 'primaryEmail' },
  ],
}

export function datasetAdapter(key: string) {
  return key === contactsDataset.key ? contactsDataset : null
}

const MAX_ROWS = 1000
const POLL_MS = 5000
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('vc-contacts')
const query = { columns: ['id', 'displayName', 'title', 'primaryEmail'] as ('id' | 'displayName' | 'title' | 'primaryEmail')[], sort: { field: 'displayName' as const, direction: 'asc' as const } }

const rowKey = (workspaceId: string) => [...keys.workspace(workspaceId), 'dataset', 'contacts'] as const

function toRow(id: string, version: number, cells: Record<string, unknown>): DatasetRow {
  const out: Record<string, string> = {}
  for (const column of contactsDataset.columns) out[column.key] = String(cells[column.field] ?? '')
  return { id, version, cells: out }
}

async function loadAll(workspaceId: string) {
  const rows: DatasetRow[] = []
  let cursor: string | undefined
  let total = 0
  do {
    const page = await documentDatasetsApi.queryContacts(workspaceId, { query, limit: 100, cursor })
    total = page.meta.total
    rows.push(...page.data.map((r) => toRow(r.id, r.version, r.cells)))
    cursor = page.meta.nextCursor ?? undefined
  } while (cursor && rows.length < MAX_ROWS)
  return { rows, total, refreshedAt: Date.now() }
}

/** Current contacts of the workspace; refreshes on focus, on a timer, and when another tab writes. */
export function useDatasetRows(workspaceId: string | null) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!channel || !workspaceId) return
    const onMessage = (event: MessageEvent<{ workspaceId: string }>) => {
      if (event.data.workspaceId === workspaceId) void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
    }
    channel.addEventListener('message', onMessage)
    return () => channel.removeEventListener('message', onMessage)
  }, [queryClient, workspaceId])
  return useQuery({
    queryKey: rowKey(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: () => loadAll(workspaceId!),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  })
}

/** One cell → one versioned command on the canonical contact. */
export function useDatasetEdit(workspaceId: string | null) {
  const queryClient = useQueryClient()
  return async (input: EditInput): Promise<EditResult> => {
    const column = contactsDataset.columns.find((c) => c.key === input.field)
    if (!workspaceId || !column) return { status: 'failed', message: 'Unknown contact field' }
    if (!column.editable) return { status: 'failed', message: `${column.label} is read only` }
    try {
      const contact = await documentDatasetsApi.updateContact(workspaceId, input.rowId, {
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        changes: { [column.field]: input.value },
      })
      const row = toRow(contact.id, contact.version, contact as unknown as Record<string, unknown>)
      // Every contacts view in this tab (grids, contact screens, timelines), then other tabs.
      await queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
      channel?.postMessage({ workspaceId })
      return { status: 'updated', row }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONTACT_VERSION_CONFLICT') {
        // Show the committed value from the record itself, not the (stale) grid cache.
        void queryClient.invalidateQueries({ queryKey: rowKey(workspaceId) })
        const current = await getApiClient()
          .GET('/workspaces/{workspaceId}/contacts/{contactId}', { params: { path: { workspaceId, contactId: input.rowId } } })
          .then((res) => { const c = unwrap(res).data; return toRow(c.id, c.version, c as unknown as Record<string, unknown>) })
          .catch(() => null)
        return { status: 'conflict', current, proposed: input.value }
      }
      return { status: 'failed', message: error instanceof Error ? error.message : 'Update failed' }
    }
  }
}
