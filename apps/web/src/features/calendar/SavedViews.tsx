import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCreateTaskView, useDeleteTaskView, useTaskViews } from '@project/sdk'
import { useCalendar } from './store'

// A member's saved views: one click restores a view and its filters (the same URL
// query the Calendar writes). Personal; the server keeps them.

/** The query keys a view holds, in the server's order, so equal views compare equal. */
const KEYS = ['view', 'who', 'type', 'area', 'priority', 'attention', 'q']

export function viewQuery(search: string) {
  const params = new URLSearchParams(search)
  const out = new URLSearchParams()
  for (const key of KEYS) {
    const value = params.get(key)?.trim()
    if (value) out.set(key, value)
  }
  return out.toString()
}

export function SavedViews({ workspaceId }: { workspaceId: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const list = useTaskViews(workspaceId)
  const create = useCreateTaskView(workspaceId)
  const remove = useDeleteTaskView(workspaceId)
  const say = useCalendar((s) => s.say)
  const [naming, setNaming] = useState<string | null>(null)
  const views = list.data ?? []
  const current = viewQuery(location.search)

  const apply = (query: string) => {
    const params = new URLSearchParams(location.search)
    for (const key of KEYS) params.delete(key)
    for (const [key, value] of new URLSearchParams(query)) params.set(key, value)
    navigate({ pathname: location.pathname, search: params.toString() })
  }

  const save = () => {
    const name = naming?.trim()
    if (!name) return setNaming(null)
    create.mutate({ name, query: current }, {
      onSuccess: () => { setNaming(null); say(`Saved view “${name}”.`) },
      onError: (err) => say((err as Error).message || "Couldn't save the view."),
    })
  }

  if (!views.length && naming === null) {
    return (
      <div className="cal-views" role="group" aria-label="Saved views">
        <button type="button" className="cal-link-btn" onClick={() => setNaming('')}>Save this view</button>
      </div>
    )
  }

  return (
    <div className="cal-views" role="group" aria-label="Saved views">
      {views.map((v) => (
        <span key={v.id} className="cal-view-chip" data-active={v.query === current || undefined}>
          <button type="button" aria-pressed={v.query === current} onClick={() => apply(v.query)}>{v.name}</button>
          <button type="button" className="cal-view-chip-x" aria-label={`Delete view ${v.name}`}
            onClick={() => remove.mutate(v.id, { onSuccess: () => say(`Deleted view “${v.name}”.`), onError: () => say("Couldn't delete the view.") })}>×</button>
        </span>
      ))}
      {naming === null ? (
        !views.some((v) => v.query === current) && <button type="button" className="cal-link-btn" onClick={() => setNaming('')}>Save this view</button>
      ) : (
        <form className="cal-view-name" onSubmit={(e) => { e.preventDefault(); save() }}>
          <input autoFocus aria-label="View name" placeholder="Name this view" maxLength={60} value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null) } }} />
          <button type="submit" className="cal-btn" disabled={!naming.trim() || create.isPending}>Save</button>
          <button type="button" className="cal-link-btn" onClick={() => setNaming(null)}>Cancel</button>
        </form>
      )}
    </div>
  )
}
