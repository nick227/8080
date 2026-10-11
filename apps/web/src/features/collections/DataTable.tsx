import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { TableState } from './table'
import '../documents/DocumentsList.css'
import './collections.css'

/**
 * The shared collection table (redesign D9): sortable headers, optional selection, a
 * whole row opens its item (click, Enter), arrow keys / j k move between rows. Domain
 * cells come from the columns; interactive controls inside a cell stop the row click.
 */
export function DataTable<T>({ label, rows: allRows, getId, state, onOpen, selection, empty, rowProps, useRow, footer, tableClass, groupBy, onRowKey }: {
  label: string
  rows: T[]
  getId: (row: T) => string
  state: TableState<T>
  onOpen?: (row: T) => void
  /** `limit`: "select all" takes at most this many (bulk actions have a cap); `disabled`: rows that can't be selected yet. */
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void; limit?: number; disabled?: (row: T) => boolean }
  empty?: ReactNode
  rowProps?: (row: T) => Record<string, string | undefined>
  /** A hook run once per row (e.g. an inline editor); its result reaches every cell as `ctx`. */
  useRow?: (row: T) => unknown
  /** Under the table: "Load more", totals. */
  footer?: ReactNode
  /** A domain class on the table for its column widths and cell styling. */
  tableClass?: string
  /** Group rows (already sorted) under collapsible headers; groups sort by `order`. */
  groupBy?: (row: T) => { id: string; label: string; order: number | string }
  /** Extra keys on a focused row (shortcuts, F2); return true when handled. */
  onRowKey?: (e: ReactKeyboardEvent<HTMLTableRowElement>, row: T, ctx: unknown) => boolean
}) {
  const body = useRef<HTMLTableSectionElement>(null)
  // The roving tab stop follows the row (by id), so a re-sort keeps focus on the same item.
  const [focusId, setFocusId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Groups keep the rows' order inside each group; collapsed groups hide their rows.
  const groups = (() => {
    if (!groupBy) return [{ id: '', label: '', order: 0, rows: allRows }]
    const map = new Map<string, { id: string; label: string; order: number | string; rows: T[] }>()
    for (const row of allRows) {
      const g = groupBy(row)
      if (!map.has(g.id)) map.set(g.id, { ...g, rows: [] })
      map.get(g.id)!.rows.push(row)
    }
    return [...map.values()].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  })()
  const rows = groups.flatMap((g) => (collapsed.has(g.id) ? [] : g.rows))
  const ids = rows.map(getId)
  const focusIndex = Math.max(0, focusId ? ids.indexOf(focusId) : 0)
  const columns = state.visible
  const span = columns.length + (selection ? 1 : 0)

  const focusRow = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index))
    setFocusId(ids[next] ?? null)
    ;(body.current?.querySelector(`tr[data-row-id="${CSS.escape(ids[next] ?? '')}"]`) as HTMLElement | null)?.focus()
  }
  useEffect(() => {
    // Keep keyboard focus on the same row when the order changes under it.
    const active = document.activeElement
    if (!focusId || !body.current?.contains(active) || active?.tagName !== 'TR') return
    const row = body.current.querySelector(`tr[data-row-id="${CSS.escape(focusId)}"]`) as HTMLElement | null
    if (row && row !== active) row.focus()
  })
  const toggle = (id: string) => {
    if (!selection) return
    const next = new Set(selection.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selection.onChange(next)
  }
  const allIds = rows.filter((row) => !selection?.disabled?.(row)).map(getId).slice(0, selection?.limit ?? Infinity)
  const allSelected = !!selection && allIds.length > 0 && allIds.every((id) => selection.selected.has(id))
  const someSelected = !!selection && !allSelected && allIds.some((id) => selection.selected.has(id))

  return (
    <div className="docs-table-wrap collection-table-wrap" role="region" aria-label={label} tabIndex={-1}>
      <table className={`docs-table collection-table${tableClass ? ` ${tableClass}` : ''}`} aria-label={label}>
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
              const active = state.sort.id === (c.sortKey ?? c.id)
              return (
                <th key={c.id} scope="col" className={c.className} title={c.headerTitle} data-align={c.align} aria-sort={active ? (state.sort.dir === 1 ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined}>
                  {c.sortValue ? (
                    <button type="button" className="docs-sort" data-active={active || undefined} onClick={() => state.sortBy(c.sortKey ?? c.id)}>
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
          {allRows.length === 0 ? (
            <tr className="docs-none"><td colSpan={span}>{empty ?? 'Nothing here yet.'}</td></tr>
          ) : groups.map((g) => (
            <GroupRows key={g.id || 'all'} label={groupBy ? g.label : null} count={g.rows.length} span={span}
              collapsed={collapsed.has(g.id)}
              onToggle={() => setCollapsed((c) => { const n = new Set(c); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n })}>
              {g.rows.map((row) => {
                const id = getId(row)
                const index = ids.indexOf(id)
                return (
                  <DataRow
                    key={id}
                    row={row}
                    id={id}
                    columns={columns}
                    tabbable={index === focusIndex}
                    selected={!!selection?.selected.has(id)}
                    selectable={!!selection}
                    selectBlocked={!!selection && (!!selection.disabled?.(row) || (!!selection.limit && !selection.selected.has(id) && selection.selected.size >= selection.limit))}
                    extra={rowProps?.(row)}
                    useRow={useRow}
                    onRowKey={onRowKey}
                    onFocus={() => setFocusId(id)}
                    onOpen={onOpen ? () => onOpen(row) : undefined}
                    onToggle={() => toggle(id)}
                    onMove={(e) => {
                      if (e.key === 'ArrowDown' || (e.key === 'j' && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); focusRow(index + 1) }
                      else if (e.key === 'ArrowUp' || (e.key === 'k' && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); focusRow(index - 1) }
                      else if (e.key === 'Home') { e.preventDefault(); focusRow(0) }
                      else if (e.key === 'End') { e.preventDefault(); focusRow(rows.length - 1) }
                    }}
                  />
                )
              })}
            </GroupRows>
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  )
}

function GroupRows({ label, count, span, collapsed, onToggle, children }: { label: string | null; count: number; span: number; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  if (label === null) return <>{children}</>
  return (
    <>
      <tr className="collection-group">
        <th colSpan={span} scope="rowgroup">
          <button type="button" aria-expanded={!collapsed} onClick={onToggle}>
            <span aria-hidden>{collapsed ? '▸' : '▾'}</span> {label} <span className="collection-group-count">{count}</span>
          </button>
        </th>
      </tr>
      {!collapsed && children}
    </>
  )
}

function DataRow<T>({ row, id, columns, tabbable, selected, selectable, selectBlocked, extra, useRow, onRowKey, onFocus, onOpen, onToggle, onMove }: {
  row: T
  id: string
  columns: TableState<T>['visible']
  tabbable: boolean
  selected: boolean
  selectable: boolean
  selectBlocked: boolean
  extra?: Record<string, string | undefined>
  useRow?: (row: T) => unknown
  onRowKey?: (e: ReactKeyboardEvent<HTMLTableRowElement>, row: T, ctx: unknown) => boolean
  onFocus: () => void
  onOpen?: () => void
  onToggle: () => void
  onMove: (e: ReactKeyboardEvent<HTMLTableRowElement>) => void
}) {
  // One hook per row; a table passes useRow always or never, so the order is stable.
  const ctx = useRow ? useRow(row) : undefined
  return (
    <tr
      data-row-id={id}
      tabIndex={tabbable ? 0 : -1}
      data-selected={selected ? '' : undefined}
      data-open={onOpen ? '' : undefined}
      {...extra}
      onFocus={onFocus}
      onClick={(e) => {
        // A control inside the row (link, button, input) handles its own click.
        if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label, [data-editable]')) return
        onOpen?.()
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (onRowKey?.(e, row, ctx)) { e.preventDefault(); e.stopPropagation(); return }
        if (e.key === 'Enter' && onOpen) { e.preventDefault(); onOpen(); return }
        if (e.key === ' ' && selectable) { e.preventDefault(); onToggle(); return }
        onMove(e)
      }}
    >
      {selectable && (
        <td className="collection-select-cell">
          <input type="checkbox" aria-label="Select row" checked={selected} disabled={selectBlocked} title={selectBlocked ? 'Up to 50 at a time' : undefined} onChange={onToggle} />
        </td>
      )}
      {columns.map((c) => (
        <td key={c.id} className={c.className} data-align={c.align} data-editable={c.editable ? '' : undefined} data-label={c.header || undefined} title={c.title?.(row)}>{c.cell(row, ctx)}</td>
      ))}
    </tr>
  )
}
