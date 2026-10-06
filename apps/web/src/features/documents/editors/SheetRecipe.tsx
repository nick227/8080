import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getApiClient, unwrap } from '@project/sdk'
import { useDocuments } from '../store'
import type { DocumentRecord } from '../types'

// A generated sheet says what it was made from and when (doc/13 A1/A2). When the
// records have changed since, it offers to make it again — a new sheet beside this
// one; this sheet and its edits are never overwritten.

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function SheetRecipe({ doc }: { doc: DocumentRecord }) {
  const workspaceId = useDocuments((state) => state.workspaceId)
  const open = useDocuments((state) => state.open)
  const refresh = useDocuments((state) => state.refresh)
  const queryClient = useQueryClient()
  const [making, setMaking] = useState(false)
  const [error, setError] = useState('')
  const recipe = useQuery({
    queryKey: ['document-recipe', workspaceId, doc.id],
    enabled: !!workspaceId,
    staleTime: 30_000,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/documents/{documentId}/recipe', { params: { path: { workspaceId: workspaceId!, documentId: doc.id } } })).data,
  })
  const data = recipe.data
  if (!data) return null
  const r = data.recipe as { summary?: string; asOf?: string }

  const again = async () => {
    setMaking(true)
    setError('')
    try {
      const made = unwrap(await getApiClient().POST('/workspaces/{workspaceId}/documents/{documentId}/regenerate', { params: { path: { workspaceId: workspaceId!, documentId: doc.id } }, body: { idempotencyKey: crypto.randomUUID() } })).data
      await refresh()
      void queryClient.invalidateQueries({ queryKey: ['document-recipe', workspaceId, doc.id] })
      open(made.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t make it again')
    } finally {
      setMaking(false)
    }
  }

  return (
    <div className="work-recipe" role="note">
      <span className="work-recipe-what">{r.summary ?? 'Made from your records'}</span>
      {r.asOf && <span className="work-recipe-when">As of {when(r.asOf)}</span>}
      {data.stale && (
        <span className="work-recipe-stale">
          {data.dataChanged ? 'The records have changed since.' : 'The dates it covers have moved on.'}
          <button type="button" className="work-add" disabled={making} onClick={() => void again()}>{making ? 'Making…' : 'Make it again'}</button>
        </span>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
