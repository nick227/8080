import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { onCompanyPath, projectPath, taskPath, tasksPath } from '../tasks/links'
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
/** Desks a company URL may name (`/c/:id/:desk`). The live floor belongs to rooms. */
export const COMPANY_DESKS: readonly Desk[] = DESKS.map((d) => d.id).filter((id) => id !== 'stream' && id !== 'company')

export function useWorkPlace() {
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const legacyView = params.get('view')
  const basePath = projectPath(location.pathname)
  const company = onCompanyPath(location.pathname)
  const segment = company ? location.pathname.slice(basePath.length).split('/')[1] ?? '' : ''
  const onTasks = location.pathname.startsWith(`${basePath}/tasks`)
  const queryDesk = params.get('desk')
  // On a company path, Stream is the company's conversation list (/c/:id/conversations).
  const requestedDesk = onTasks ? 'tasks' : company ? (segment === 'conversations' ? 'stream' : segment === 'stream' ? 'unknown' : segment || 'company') : queryDesk
  const legacyTicket = params.get('ticket')
  useEffect(() => {
    if (legacyTicket) navigate(taskPath(location.pathname, legacyTicket), { replace: true })
  }, [legacyTicket, location.pathname, navigate])
  // On a company route, links that only set `?desk=` (record links, contact → automation)
  // land on that desk's own path, keeping the rest of their query.
  useEffect(() => {
    if (!company || !queryDesk || legacyTicket) return
    const next = new URLSearchParams(location.search)
    next.delete('desk')
    const target = legacyDesk(queryDesk, legacyView)
    if (target === 'company') next.delete('view') // 'table' meant the overview's task table
    navigate({ pathname: deskPath(basePath, target as Desk), search: next.toString() }, { replace: true, state: location.state })
  }, [company, queryDesk, legacyView, legacyTicket, basePath, location.search, location.state, navigate])
  // One address per page: /c/:id/company is the overview at /c/:id.
  useEffect(() => {
    if (company && segment === 'company') navigate({ pathname: basePath, search: location.search }, { replace: true })
  }, [company, segment, basePath, location.search, navigate])
  // Company paths name their desk exactly; old ?desk= links were mapped by the redirect.
  const requested = company ? requestedDesk : legacyDesk(requestedDesk, legacyView)
  const known = company
    ? requested === 'company' || requested === 'stream' || COMPANY_DESKS.includes(requested as Desk)
    : DESKS.some((d) => d.id === requested)
  // A room opens on its conversation; a company on its overview.
  const place: Desk = known ? (requested as Desk) : company ? 'company' : 'stream'
  useEffect(() => {
    // Inspecting a related record must not replace the other area's working session.
    if ((location.state as RecordNavigationState | null)?.origin) return
    // A one-time arrival note (fromRoom) isn't part of a desk's working state.
    const { fromRoom: _arrival, ...kept } = (location.state ?? {}) as Record<string, unknown>
    const value = { search: location.search, state: Object.keys(kept).length ? kept : null }
    const key = keyFor(basePath, place)
    memory.set(key, value)
    try {
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* Memory still works without storage. */
    }
  }, [location.pathname, location.search, location.state, place, basePath])
  const select = (desk: Desk) => {
    if (desk === place) return
    const saved = read(basePath, desk)
    const params = new URLSearchParams(saved?.search ?? '')
    params.delete('ticket')
    if (company) params.delete('desk')
    else params.set('desk', desk)
    const pathname = company ? deskPath(basePath, desk) : desk === 'tasks' ? tasksPath(basePath) : basePath
    navigate({ pathname, search: params.toString() }, { state: saved?.state ?? null })
  }
  // Third item: a company URL that names a desk that doesn't exist (the page shows not-found).
  // Fourth: a redirect is about to replace this URL; render no desk until it lands, so the
  // wrong desk never mounts (the overview's task table would reset shared view state).
  const redirecting = company && (Boolean(queryDesk) || Boolean(legacyTicket) || segment === 'company')
  return [place, select, company && !known, redirecting] as const
}

/** Keep shared links to the former Calendar views working in their new home. */
function legacyDesk(desk: string | null, view: string | null) {
  if (desk === 'calendar' && view === 'table') return 'company'
  if (desk === 'calendar' && ['board', 'backlog', 'reports'].includes(view ?? '')) return 'board'
  return desk
}

/** A desk's address under a company base path. */
export function deskPath(base: string, desk: Desk) {
  return desk === 'company' ? base : desk === 'stream' ? `${base}/conversations` : `${base}/${desk}`
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
    // Company routes carry the desk in the path; rooms in the query.
    if (onCompanyPath(location.pathname)) next.delete('desk')
    else next.set('desk', kind)
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
        // The way back names its desk explicitly: on a company path the query alone
        // doesn't carry it, and the ?desk= redirect then routes Back to the right desk.
        const back = new URLSearchParams(search({ preview: null, previewKind: null }).slice(1))
        back.set('desk', kind)
        go(`?${next}`, {
          origin: {
            search: `?${back}`,
            results: state.results,
            name: originName,
          },
        })
      }
    },
    back: () => {
      if (state.origin) go(state.origin.search, { results: state.origin.results })
      else go(state.results?.search ?? (onCompanyPath(location.pathname) ? '?' : `?desk=${kind}`), { results: state.results })
    },
  }
}
