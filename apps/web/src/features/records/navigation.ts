import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DESKS, type Desk } from '../work/sections'

export type RecordKind = 'contacts' | 'inventory'
export type RecordRef = { kind: RecordKind; id: string; name: string }
export type ResultContext = {
  kind: RecordKind
  ids: string[]
  complete: boolean
  label: string
  search: string
  scroll: number
  focusId: string
}
export type RecordNavigationState = {
  results?: ResultContext
  trail?: RecordRef[]
  origin?: { search: string; results?: ResultContext; name: string }
}
const memory = new Map<string, { search: string; state: RecordNavigationState | null }>()
const keyFor = (path: string, desk: Desk) => `records.navigation:${path}:${desk}`
function read(path: string, desk: Desk) {
  const key = keyFor(path, desk)
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null') ?? memory.get(key)
  } catch {
    return memory.get(key)
  }
}
export function useWorkPlace() {
  const location = useLocation()
  const navigate = useNavigate()
  const requested = new URLSearchParams(location.search).get('desk')
  const place: Desk = DESKS.some((d) => d.id === requested) ? (requested as Desk) : 'company'
  useEffect(() => {
    // Inspecting a related record must not replace the other area's working session.
    if ((location.state as RecordNavigationState | null)?.origin) return
    const value = { search: location.search, state: location.state }
    const key = keyFor(location.pathname, place)
    memory.set(key, value)
    try {
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* Memory still works without storage. */
    }
  }, [location.pathname, location.search, location.state, place])
  const select = (desk: Desk) => {
    if (desk === place) return
    const saved = read(location.pathname, desk)
    const params = new URLSearchParams(saved?.search ?? '')
    params.set('desk', desk)
    navigate({ pathname: location.pathname, search: params.toString() }, { state: saved?.state ?? null })
  }
  return [place, select] as const
}

export function useRecordNavigation(kind: RecordKind) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const state = (location.state ?? {}) as RecordNavigationState
  const recordId = params.get('record')
  const previewId = params.get('preview')
  const previewKind: RecordKind = params.get('previewKind') === 'inventory' ? 'inventory' : 'contacts'
  function search(patch: Record<string, string | null>) {
    const next = new URLSearchParams(location.search)
    next.set('desk', kind)
    for (const [key, value] of Object.entries(patch)) value === null ? next.delete(key) : next.set(key, value)
    return `?${next.toString()}`
  }
  const go = (nextSearch: string, nextState: RecordNavigationState = state, replace = false) =>
    navigate({ search: nextSearch }, { state: nextState, replace })
  return {
    params,
    state,
    recordId,
    previewId,
    previewKind,
    setFilter: (key: string, value: string) =>
      go(search({ [key]: value || null, record: null, preview: null, previewKind: null }), {}, true),
    setFilters: (patch: Record<string, string | null>) =>
      go(
        search({
          ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value || null])),
          record: null,
          preview: null,
          previewKind: null,
        }),
        {},
        true,
      ),
    href: (id: string) => search({ record: id, preview: null, previewKind: null }),
    open: (id: string, results?: ResultContext) => {
      const patch: Record<string, string | null> = { record: id, preview: null, previewKind: null }
      if (results?.search) {
        const fromResults = new URLSearchParams(results.search.startsWith('?') ? results.search.slice(1) : results.search)
        for (const key of ['q', 'stage', 'status', 'focus', 'sort', 'dir'] as const)
          patch[key] = fromResults.get(key)
      }
      go(search(patch), { results })
    },
    preview: (ref: RecordRef, results?: ResultContext) =>
      go(search({ preview: ref.id, previewKind: ref.kind }), {
        ...state,
        results: results ?? state.results,
        trail: [ref],
      }),
    related: (ref: RecordRef) =>
      go(search({ preview: ref.id, previewKind: ref.kind }), {
        ...state,
        trail: [...(state.trail ?? []), ref],
      }),
    closePreview: () => go(search({ preview: null, previewKind: null }), { ...state, trail: undefined }),
    previewBack: () => {
      const trail = state.trail?.slice(0, -1) ?? []
      const previous = trail.at(-1)
      if (previous) go(search({ preview: previous.id, previewKind: previous.kind }), { ...state, trail })
    },
    step: (id: string, preview: boolean, results: ResultContext) =>
      go(search(preview ? { preview: id, previewKind: kind } : { record: id }), {
        ...state,
        results,
        trail: undefined,
      }),
    updateResults: (results: ResultContext) => go(location.search, { ...state, results }, true),
    expand: (ref: RecordRef, originName: string) => {
      if (!recordId && ref.kind === kind)
        go(search({ record: ref.id, preview: null, previewKind: null }), { results: state.results })
      else {
        const next = new URLSearchParams({ desk: ref.kind, record: ref.id })
        go(`?${next}`, {
          origin: {
            search: search({ preview: null, previewKind: null }),
            results: state.results,
            name: originName,
          },
        })
      }
    },
    back: () => {
      if (state.origin) go(state.origin.search, { results: state.origin.results })
      else go(state.results?.search ?? `?desk=${kind}`, { results: state.results })
    },
  }
}
