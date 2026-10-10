import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** One column of a shared collection table (redesign D9). Domains supply cells; the table owns layout. */
export type Column<T> = {
  id: string
  header: string
  cell: (row: T) => ReactNode
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
}

export type Sort = { id: string; dir: 1 | -1 }

type Saved = { sort?: Sort; hidden?: string[] }
const key = (collection: string) => `8080.table.${collection}`

function load(collection: string): Saved {
  try { return JSON.parse(localStorage.getItem(key(collection)) || '{}') as Saved } catch { return {} }
}

const compareValues = (a: unknown, b: unknown) => {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Sort and column visibility for one collection's table, remembered in this browser
 * (a per-viewer convenience; nothing shared depends on it).
 */
export function useTableState<T>(collection: string, columns: Column<T>[], initial: Sort) {
  const [saved] = useState(() => load(collection))
  const [sort, setSortState] = useState<Sort>(() => (saved.sort && columns.some((c) => c.id === saved.sort!.id && c.sortValue) ? saved.sort : initial))
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(saved.hidden ?? columns.filter((c) => c.defaultHidden).map((c) => c.id)))
  useEffect(() => {
    try { localStorage.setItem(key(collection), JSON.stringify({ sort, hidden: [...hidden] })) } catch { /* this visit only */ }
  }, [collection, sort, hidden])

  const sortBy = useCallback((id: string) => {
    const column = columns.find((c) => c.id === id)
    if (!column?.sortValue) return
    setSortState((current) => (current.id === id ? { id, dir: current.dir === 1 ? -1 : 1 } : { id, dir: column.firstDir ?? 1 }))
  }, [columns])
  const toggle = useCallback((id: string) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const visible = useMemo(() => columns.filter((c, i) => i === 0 || c.hideable === false || !hidden.has(c.id)), [columns, hidden])
  const sortRows = useCallback((rows: T[], tiebreak?: (a: T, b: T) => number) => {
    const column = columns.find((c) => c.id === sort.id)
    if (!column?.sortValue) return rows
    const value = column.sortValue
    return [...rows].sort((a, b) => sort.dir * compareValues(value(a), value(b)) || (tiebreak?.(a, b) ?? 0))
  }, [columns, sort])

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
