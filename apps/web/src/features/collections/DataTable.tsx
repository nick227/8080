import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TableState } from './table'
import '../documents/DocumentsList.css'
import './collections.css'

/**
 * The shared collection table (redesign D9): sortable headers, optional selection, a
 * whole row opens its item (click, Enter), arrow keys / j k move between rows. Domain
 * cells come from the columns; interactive controls inside a cell stop the row click.
 */
export function DataTable<T>({ label, rows, getId, state, onOpen, selection, empty, rowProps }: {
  label: string
  rows: T[]
  getId: (row: T) => string
  state: TableState<T>
  onOpen?: (row: T) => void
  /** `limit`: "select all" takes at most this many (bulk actions have a cap). */
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void; limit?: number }
  empty?: ReactNode
  rowProps?: (row: T) => Record<string, string | undefined>
}) {
  const body = useRef<HTMLTableSectionElement>(null)
  // The roving tab stop follows the row (by id), so a re-sort keeps focus on the same item.
  const [focusId, setFocusId] = useState<string | null>(null)
  const ids = rows.map(getId)
  const focusIndex = Math.max(0, focusId ? ids.indexOf(focusId) : 0)
  const columns = state.visible
  const span = columns.length + (selection ? 1 : 0)

  const focusRow = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index))
    setFocusId(ids[next] ?? null)
    ;(body.current?.children[next] as HTMLElement | undefined)?.focus()
  }
  useEffect(() => {
    // Keep keyboard focus on the same row when the order changes under it.
    const active = document.activeElement
    if (!focusId || !body.current?.contains(active) || active?.tagName !== 'TR') return
    const row = body.current.children[ids.indexOf(focusId)] as HTMLElement | undefined
    if (row && row !== active) row.focus()
  })
  const toggle = (id: string) => {
    if (!selection) return
    const next = new Set(selection.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selection.onChange(next)
  }
  const allIds = rows.map(getId).slice(0, selection?.limit ?? Infinity)
  const allSelected = !!selection && allIds.length > 0 && allIds.every((id) => selection.selected.has(id))
  const someSelected = !!selection && !allSelected && allIds.some((id) => selection.selected.has(id))

  return (
    <div className="docs-table-wrap collection-table-wrap" role="region" aria-label={label} tabIndex={-1}>
      <table className="docs-table collection-table" aria-label={label}>
        <colgroup>
          {selection && <col style={{ width: '2.5rem' }} />}
          {columns.map((c) => <col key={c.id} style={c.width ? { width: c.width } : undefined} />)}
        </colgroup>
        <thead>
          <tr>
            {selection && (
              <th className="collection-select-cell">
                <input
                  type="checkbox"
                  aria-label={allSelected ? 'Clear selection' : selection.limit && rows.length > selection.limit ? `Select the first ${selection.limit}` : 'Select all shown'}
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected }}
                  onChange={() => selection.onChange(allSelected ? new Set() : new Set(allIds))}
                />
              </th>
            )}
            {columns.map((c) => {
              const active = state.sort.id === c.id
              return (
                <th key={c.id} scope="col" data-align={c.align} aria-sort={active ? (state.sort.dir === 1 ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined}>
                  {c.sortValue ? (
                    <button type="button" className="docs-sort" data-active={active || undefined} onClick={() => state.sortBy(c.id)}>
                      {c.header}
                      <span className="docs-sort-dir" aria-hidden>{active ? (state.sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
                    </button>
                  ) : (
                    <span className="docs-sort">{c.header}</span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody ref={body}>
          {rows.length === 0 ? (
            <tr className="docs-none"><td colSpan={span}>{empty ?? 'Nothing here yet.'}</td></tr>
          ) : rows.map((row, index) => {
            const id = getId(row)
            const selected = selection?.selected.has(id)
            return (
              <tr
                key={id}
                tabIndex={index === focusIndex ? 0 : -1}
                data-selected={selected ? '' : undefined}
                data-open={onOpen ? '' : undefined}
                {...rowProps?.(row)}
                onFocus={() => setFocusId(id)}
                onClick={(e) => {
                  // A control inside the row (link, button, input) handles its own click.
                  if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label')) return
                  onOpen?.(row)
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'ArrowDown' || (e.key === 'j' && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); focusRow(index + 1) }
                  else if (e.key === 'ArrowUp' || (e.key === 'k' && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); focusRow(index - 1) }
                  else if (e.key === 'Home') { e.preventDefault(); focusRow(0) }
                  else if (e.key === 'End') { e.preventDefault(); focusRow(rows.length - 1) }
                  else if (e.key === 'Enter' && onOpen) { e.preventDefault(); onOpen(row) }
                  else if (e.key === ' ' && selection) { e.preventDefault(); toggle(id) }
                }}
              >
                {selection && (
                  <td className="collection-select-cell">
                    <input type="checkbox" aria-label="Select row" checked={!!selected} onChange={() => toggle(id)} />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.id} data-align={c.align} title={c.title?.(row)}>{c.cell(row)}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
