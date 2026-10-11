import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** One column of a shared collection table (redesign D9). Domains supply cells; the table owns layout. */
export type Column<T> = {
  id: string
  header: string
  /** `ctx` is the table's per-row hook result (DataTable `useRow`), e.g. a row editor. */
  cell: (row: T, ctx: unknown) => ReactNode
  /** Sortable when given. Nulls sort last. */
  sortValue?: (row: T) => string | number | null | undefined
  /** First click sorts this way (dates usually newest first). */
  firstDir?: 1 | -1
  /** CSS width, e.g. '28%' or '9rem'. */
  width?: string
  align?: 'start' | 'end'
  /** Can be hidden from the Columns menu (default true; the first column never hides). */
  hideable?: boolean
  defaultHidden?: boolean
  /** Text for the cell's tooltip when it truncates. */
  title?: (row: T) => string | undefined
  /** The API's sort key when it differs from the column id (server-sorted lists). */
  sortKey?: string
  /** Header tooltip explaining the column. */
  headerTitle?: string
  /** Class for this column's header and cells (domain styling hooks). */
  className?: string
  /** Clicks anywhere in this cell edit it instead of opening the row. */
  editable?: boolean
}

export type Sort = { id: string; dir: 1 | -1 }

// Per viewer: only the columns this person explicitly showed or hid (redesign D9). A
// column added later keeps its own default until someone toggles it.
type Saved = { shown?: string[]; hidden?: string[] }
const key = (collection: string) => `8080.table.${collection}`

// Only lists of column ids are trusted; anything else (older formats, edits) is ignored.
const ids = (value: unknown) => (Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined)
function load(collection: string): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(key(collection)) || '{}') as Record<string, unknown> | null
    return { shown: ids(raw?.shown), hidden: ids(raw?.hidden) }
  } catch { return {} }
}

const compareValues = (a: unknown, b: unknown) => {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * A collection table's sort and columns (redesign D9). Sort lives in the URL (`sort`,
 * `dir`) like search and filters, so Back, links and saved views keep it; column
 * visibility is a per-viewer preference. With `server`, the API sorts (the caller owns
 * the URL) and the table only shows and changes it.
 */
export function useTableState<T>(collection: string, columns: Column<T>[], initial: Sort, server?: { sort: Sort; onSort: (id: string) => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [prefs, setPrefs] = useState<Saved>(() => load(collection))
  useEffect(() => {
    try { localStorage.setItem(key(collection), JSON.stringify(prefs)) } catch { /* this visit only */ }
  }, [collection, prefs])

  const params = new URLSearchParams(location.search)
  const urlSort = params.get('sort')
  const urlDir = params.get('dir')
  const fromUrl = columns.find((c) => (c.sortKey ?? c.id) === urlSort && c.sortValue)
  const sort: Sort = fromUrl ? { id: fromUrl.sortKey ?? fromUrl.id, dir: urlDir === 'desc' ? -1 : 1 } : initial

  const sortBy = useCallback((id: string) => {
    const column = columns.find((c) => (c.sortKey ?? c.id) === id)
    if (!column?.sortValue) return
    const dir = sort.id === id ? (sort.dir === 1 ? -1 : 1) : (column.firstDir ?? 1)
    const next = new URLSearchParams(location.search)
    next.set('sort', id)
    next.set('dir', dir === 1 ? 'asc' : 'desc')
    navigate({ search: next.toString() }, { replace: true, state: location.state })
  }, [columns, sort, location.search, location.state, navigate])

  const hidden = useMemo(() => new Set(columns.filter((c) =>
    prefs.hidden?.includes(c.id) || (c.defaultHidden && !prefs.shown?.includes(c.id)),
  ).map((c) => c.id)), [columns, prefs])
  const toggle = useCallback((id: string) => {
    setPrefs((current) => {
      const isHidden = hidden.has(id)
      const shown = new Set(current.shown ?? [])
      const hide = new Set(current.hidden ?? [])
      if (isHidden) { hide.delete(id); shown.add(id) } else { shown.delete(id); hide.add(id) }
      return { shown: [...shown], hidden: [...hide] }
    })
  }, [hidden])
  const visible = useMemo(() => columns.filter((c, i) => i === 0 || c.hideable === false || !hidden.has(c.id)), [columns, hidden])
  const sortRows = useCallback((rows: T[], tiebreak?: (a: T, b: T) => number) => {
    const column = columns.find((c) => (c.sortKey ?? c.id) === sort.id)
    if (!column?.sortValue) return rows
    const value = column.sortValue
    return [...rows].sort((a, b) => sort.dir * compareValues(value(a), value(b)) || (tiebreak?.(a, b) ?? 0))
  }, [columns, sort])

  if (server) return { sort: server.sort, sortBy: server.onSort, hidden, toggle, visible, columns, sortRows: (rows: T[]) => rows }
  return { sort, sortBy, hidden, toggle, visible, columns, sortRows }
}

export type TableState<T> = ReturnType<typeof useTableState<T>>

/** The list's search text, kept in the URL (`?q=`) so it survives Back and links. */
export function useUrlSearch(onChange?: (next: URLSearchParams) => void) {
  const location = useLocation()
  const navigate = useNavigate()
  const q = new URLSearchParams(location.search).get('q') ?? ''
  const [value, setValue] = useState(q)
  useEffect(() => setValue(q), [q])
  useEffect(() => {
    if (value === q) return
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(location.search)
      const trimmed = value.trim()
      if (trimmed) next.set('q', trimmed)
      else next.delete('q')
      onChange?.(next)
      navigate({ search: next.toString() }, { replace: true, state: location.state })
    }, 200)
    return () => window.clearTimeout(timer)
  }, [value, q, location.search, location.state, navigate, onChange])
  return { value, setValue, q }
}

/** Case-insensitive match of every word in `q` against the row's text. */
export function matches(q: string, ...fields: (string | null | undefined)[]) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = fields.filter(Boolean).join(' ').toLowerCase()
  return words.every((w) => text.includes(w))
}
