import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DataGrid, type ColumnWidths, type DataGridHandle, type SortColumn } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { datasetAdapter, useDatasetEdit, useDatasetRows } from '../dataset'
import { useCurrentWorkspace } from '../workspace'
import { usePeers } from '../presence'
import { useDocuments } from '../store'
import { cellText, convertColumn, formatCell, parseCell, sheetTotals, type CellType, type CellValue } from '@project/shared'
import type { DocumentRecord, NativeSheet, SheetColumn } from '../types'
import { toContent, typeOf } from '../sheetModel'
import { SheetRecipe } from './SheetRecipe'
import './sheet.css'
import { applyDisplayed, blankCells, isPadId, padRows, visibleRows, type CellIndex, type CellRange, type GridRow } from './gridRows'
import { buildSheetColumns, HEADER_HEIGHT, ROW_HEIGHT } from './sheetColumns'
import { useGridDrag } from './sheetHit'
import { sheetInteractions } from './sheetEvents'

// Ordinary sheets keep a screen of rows so the next cell is always there to type in.
// Selection is a rectangle of cells: drag, shift-click, or shift-arrows. Copy and paste
// use that rectangle. Contacts stay one cell at a time.

export function GridEditor({ doc }: { doc: DocumentRecord }) {
  const change = useDocuments((state) => state.change)
  const peers = usePeers()
  const boxRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<DataGridHandle>(null)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<readonly SortColumn[]>([])
  const [widths, setWidths] = useState<ColumnWidths>(new Map())
  const [range, setRange] = useState<CellRange | null>(null)
  const [capacity, setCapacity] = useState(24)
  const [tail, setTail] = useState(0)
  const [recordStatus, setRecordStatus] = useState('')
  const rangeRef = useRef(range)
  const hold = useRef(false)
  const shiftExtend = useRef(false)
  const grown = useRef(-1)
  rangeRef.current = range

  const dataset = doc.sheet?.mode === 'dataset' ? datasetAdapter(doc.sheet.dataset) : null
  const sheet = doc.sheet?.mode === 'sheet' ? doc.sheet : null
  const generated = !!doc.shared?.generated
  const current = useCurrentWorkspace()
  const workspaceId = dataset ? (current.workspace?.id ?? null) : null
  const live = useDatasetRows(workspaceId)
  const editRecord = useDatasetEdit(workspaceId)
  const records = useMemo(() => live.data?.rows ?? [], [live.data])
  const source = useMemo<GridRow[]>(() => {
    if (dataset) return records.map((row) => ({ id: row.id, version: String(row.version), ...row.cells }))
    // Typed cells are edited (and copied, pasted, filtered) as their plain text.
    return (sheet?.rows ?? []).map((row) => ({ id: row.id, version: '0', ...Object.fromEntries((sheet?.columns ?? []).map((c) => [c.id, cellText({ type: typeOf(c), currency: c.currency }, row.cells[c.id])])) }))
  }, [dataset, records, sheet])
  const keys = useMemo(
    () => (dataset ? dataset.columns.map((column) => column.key) : (sheet?.columns.map((column) => column.id) ?? [])),
    [dataset, sheet],
  )
  const numeric = useMemo(() => new Set((sheet?.columns ?? []).filter((c) => c.type === 'number' || c.type === 'money').map((c) => c.id)), [sheet])
  const shown = useMemo(() => visibleRows(source, filter, sort, (key) => numeric.has(key)), [source, filter, sort, numeric])
  const displayed = useMemo(
    // A generated sheet is a finished artifact: one blank row to add to, not a screen of them.
    () => (sheet && !filter.trim() ? padRows(shown, keys, generated ? shown.length + 1 + tail : Math.max(capacity, shown.length + 1 + tail)) : shown),
    [sheet, filter, shown, keys, capacity, tail, generated],
  )
  const indexOf = useMemo(() => new Map(displayed.map((row, index) => [row.id, index])), [displayed])
  const remoteIds = useMemo(() => new Set(peers.flatMap((peer) => (peer.focus?.kind === 'cell' && peer.focus.id ? [peer.focus.id] : []))), [peers])
  const view = useRef({ rows: displayed.length, cols: keys.length })
  view.current = { rows: displayed.length, cols: keys.length }
  const drag = useGridDrag(view, (anchor, focus) => setRange({ anchor, focus }), () => { if (sheet) setTail((count) => count + 8) })

  const sortId = sort.map((item) => `${item.columnKey}:${item.direction}`).join()
  useEffect(() => { setRange(null); setTail(0); grown.current = -1 }, [filter, sortId, doc.id])

  useLayoutEffect(() => {
    const grid = boxRef.current?.querySelector('.rdg')
    if (!(grid instanceof HTMLElement)) return
    const measure = () => {
      if (grid.clientHeight < 40) return
      setCapacity(Math.max(1, Math.ceil((grid.clientHeight - HEADER_HEIGHT) / ROW_HEIGHT)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [doc.id, workspaceId, sheet?.mode])

  // Text in, typed values out: what doesn't fit its column's type is refused (the cell
  // keeps its value) and said, never stored as something else.
  const save = (rows: readonly GridRow[], columns: SheetColumn[], typed?: Map<string, Record<string, CellValue>>) => {
    const before = new Map((sheet?.rows ?? []).map((row) => [row.id, row.cells]))
    const refused: string[] = []
    const native: NativeSheet = {
      mode: 'sheet',
      columns,
      rows: rows.filter((row) => !isPadId(row.id)).map((row) => ({
        id: row.id,
        cells: typed?.get(row.id) ?? Object.fromEntries(columns.map((column) => {
          const text = row[column.id] ?? ''
          const parsed = parseCell({ type: typeOf(column), currency: column.currency }, text)
          if (parsed.ok) return [column.id, parsed.value]
          refused.push(`“${text.trim()}” ${parsed.why} (${column.name})`)
          return [column.id, before.get(row.id)?.[column.id] ?? null]
        })),
      })),
    }
    // Nothing changed (e.g. every edit was refused): don't save the same sheet again.
    if (!sheet || JSON.stringify(native) !== JSON.stringify(sheet)) change(doc.id, (item) => ({ ...item, sheet: native }))
    if (refused.length) setRecordStatus(`${refused[0]} — not changed${refused.length > 1 ? ` · ${refused.length - 1} more` : ''}`)
    else if (sheet) setRecordStatus('')
  }
  const retype = (key: string, type: CellType) => {
    if (!sheet) return
    const column = sheet.columns.find((c) => c.id === key)
    if (!column || typeOf(column) === type) return
    const currency = type === 'money' ? (sheet.columns.find((c) => c.currency)?.currency ?? 'USD') : undefined
    const converted = convertColumn(toContent(sheet), key, { type, currency })
    if (!converted.ok) {
      setRecordStatus(`${converted.bad.length} ${converted.bad.length === 1 ? 'cell' : 'cells'} in “${column.name}” can’t be ${type === 'boolean' ? 'yes or no' : `${type === 'date' ? 'a date' : `a ${type}`}`} — type not changed`)
      return
    }
    const columns = sheet.columns.map((c) => (c.id === key ? { id: c.id, name: c.name, type, ...(currency ? { currency } : {}), ...(c.total && (type === 'number' || type === 'money') ? { total: c.total } : {}) } : c))
    const typed = new Map(sheet.rows.map((row) => [row.id, { ...row.cells, [key]: converted.values.get(row.id) ?? null }]))
    save(source, columns, typed)
  }
  const totals = useMemo(() => {
    if (!sheet || !sheet.columns.some((c) => c.total === 'sum')) return null
    const sums = sheetTotals(toContent(sheet))
    return Object.fromEntries(sheet.columns.filter((c) => c.id in sums).map((c) => [c.id, formatCell({ type: typeOf(c), currency: c.currency }, sums[c.id])]))
  }, [sheet])
  const commit = (next: readonly GridRow[]) => { if (sheet) save(applyDisplayed(source, next, keys), sheet.columns) }

  const place = (anchor: CellIndex, focus: CellIndex, focusCell = true) => {
    hold.current = true
    queueMicrotask(() => { hold.current = false })
    setRange({ anchor, focus })
    if (!focusCell) return
    const row = Math.min(anchor.row, focus.row)
    const col = Math.min(anchor.col, focus.col)
    gridRef.current?.setActivePosition({ idx: col + 1, rowIdx: Math.max(0, row) }, { shouldFocus: true })
  }

  const defined = useMemo(
    () => (dataset
      ? dataset.columns.map((column) => ({ key: column.key, name: column.label, editable: column.editable }))
      : (sheet?.columns ?? []).map((column) => ({ key: column.id, name: column.name, editable: true, type: typeOf(column), currency: column.currency, total: column.total === 'sum' }))),
    [dataset, sheet],
  )
  const columns = useMemo(() => buildSheetColumns({
    defined,
    indexOf,
    range,
    rowCount: displayed.length,
    sort,
    rename: !!sheet,
    remoteIds,
    onSelectAll: () => { if (keys.length && displayed.length) place({ row: 0, col: 0 }, { row: displayed.length - 1, col: keys.length - 1 }) },
    onSelectColumn: (col) => { if (displayed.length) place({ row: 0, col }, { row: displayed.length - 1, col }) },
    onRename: (key, name) => { if (sheet) save(source, sheet.columns.map((column) => (column.id === key ? { ...column, name } : column))) },
    onDelete: (key) => {
      if (!sheet) return
      setSort((current) => current.filter((item) => item.columnKey !== key))
      setRange(null)
      save(source, sheet.columns.filter((column) => column.id !== key))
    },
    onType: sheet ? retype : undefined,
    onTotal: sheet ? (key) => save(source, sheet.columns.map((c) => (c.id === key ? (c.total ? { id: c.id, name: c.name, type: c.type, ...(c.currency ? { currency: c.currency } : {}) } : { ...c, total: 'sum' as const }) : c))) : undefined,
    totals: totals ?? undefined,
    onSort: (key) => setSort((current) => {
      const hit = current.find((item) => item.columnKey === key)
      if (!hit) return [{ columnKey: key, direction: 'ASC' }]
      if (hit.direction === 'ASC') return [{ columnKey: key, direction: 'DESC' }]
      return []
    }),
  }), [defined, indexOf, range, displayed.length, sort, sheet, remoteIds, keys.length, source, totals])

  const applyDataset = async (row: GridRow, key: string, value: string) => {
    if (!dataset) return
    setRecordStatus('Updating contact…')
    const result = await editRecord({
      rowId: row.id,
      field: key,
      value,
      expectedVersion: Number(row.version),
      idempotencyKey: crypto.randomUUID(),
      sourceDocumentId: doc.id,
    })
    if (result.status === 'updated') setRecordStatus('Updated')
    else if (result.status === 'conflict') setRecordStatus(`Conflict · now “${result.current?.cells[key] ?? ''}” · yours “${result.proposed}”`)
    else setRecordStatus(result.message)
  }

  if (dataset && !workspaceId) {
    return (
      <div className="work-grid">
        <div className="work-bar">
          {current.loading ? <span role="status">Loading…</span>
            : current.guest ? <span role="status">Sign in to work with contacts.</span>
            : (
              <>
                <span role="status">{current.createError ?? 'Contacts live in a workspace.'}</span>
                <button type="button" disabled={current.creating} onClick={current.create}>Create workspace</button>
              </>
            )}
        </div>
      </div>
    )
  }

  return (
    <div className="work-grid" ref={boxRef}>
      {doc.shared?.generated && <SheetRecipe doc={doc} />}
      <div className="work-bar">
        <input className="work-filter" aria-label="Filter rows" placeholder="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
        {sheet && (
          <span className="work-adds">
            <button type="button" className="work-add" onClick={() => save([...source, { id: crypto.randomUUID(), version: '0', ...blankCells(keys) }], sheet.columns)}>+ Row</button>
            <button type="button" className="work-add" onClick={() => save(source, [...sheet.columns, { id: crypto.randomUUID(), name: `Column ${sheet.columns.length + 1}`, type: 'text' }])}>+ Column</button>
          </span>
        )}
        {sheet && recordStatus && <span role="status" className="work-sheet-note">{recordStatus}</span>}
        {dataset && (
          <span role="status">
            {recordStatus
              || (live.isError ? 'Couldn’t load contacts'
              : !live.data ? 'Loading contacts…'
              : live.data.total === 0 ? 'No contacts yet — import a CSV as contacts to start.'
              : `${dataset.description} · ${live.data.rows.length < live.data.total ? `first ${live.data.rows.length} of ` : ''}${live.data.total}`)}
          </span>
        )}
      </div>
      <DataGrid
        ref={gridRef}
        className="work-rdg"
        columns={columns}
        rows={displayed}
        rowKeyGetter={(row) => row.id}
        rowHeight={ROW_HEIGHT}
        headerRowHeight={HEADER_HEIGHT}
        sortColumns={sort}
        onSortColumnsChange={setSort}
        columnWidths={widths}
        onColumnWidthsChange={setWidths}
        bottomSummaryRows={totals ? ([{ id: 'total' }] as readonly unknown[]) : undefined}
        enableVirtualization
        {...sheetInteractions({
          keys,
          displayed,
          indexOf,
          dataset: !!dataset,
          sheet: !!sheet,
          rangeRef,
          drag,
          hold,
          shiftExtend,
          grown,
          place,
          setRange,
          setTail,
          commit,
          applyDataset,
          setRecordStatus,
        })}
      />
    </div>
  )
}
