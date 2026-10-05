import { useMemo, useState, useSyncExternalStore } from 'react'
import { DataGrid, SelectColumn, SELECT_COLUMN_KEY, renderTextEditor, type Column, type ColumnWidths, type SortColumn } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { contactsAdapter, datasetAdapter, getDatasetRows, subscribeDataset } from '../dataset'
import { notePresence, usePeers } from '../presence'
import { useDocuments } from '../store'
import type { DocumentRecord, NativeSheet } from '../types'
import { mergeRows, parseGrid, pasteMatrix, visibleRows, type GridRow } from './gridRows'

// react-data-grid 7 (MIT, React 19) virtualizes rows, edits from the keyboard,
// resizes and sorts columns, and exposes copy/paste plus shift-click row selection.
// Glide Data Grid draws rectangle selections, but its peers stop at React 18.

const selectColumn = SelectColumn as Column<GridRow>

export function GridEditor({ doc }: { doc: DocumentRecord }) {
  const change = useDocuments((state) => state.change)
  const peers = usePeers()
  const records = useSyncExternalStore(subscribeDataset, getDatasetRows, getDatasetRows)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<readonly SortColumn[]>([])
  const [widths, setWidths] = useState<ColumnWidths>(new Map())
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [recordStatus, setRecordStatus] = useState('')
  const dataset = doc.sheet?.mode === 'dataset' ? datasetAdapter(doc.sheet.dataset) : null
  const sheet = doc.sheet?.mode === 'sheet' ? doc.sheet : null

  const source = useMemo<GridRow[]>(() => {
    if (dataset) return records.map((row) => ({ id: row.id, version: String(row.version), ...row.cells }))
    return (sheet?.rows ?? []).map((row) => ({ id: row.id, version: '0', ...row.cells }))
  }, [dataset, records, sheet])

  const keys = dataset ? dataset.columns.map((column) => column.key) : (sheet?.columns.map((column) => column.id) ?? [])
  const shown = visibleRows(source, filter, sort)

  const columns = useMemo<Column<GridRow>[]>(() => {
    const defined = dataset
      ? dataset.columns.map((column) => ({ key: column.key, name: column.label, editable: column.editable }))
      : (sheet?.columns ?? []).map((column) => ({ key: column.id, name: column.name, editable: true }))
    return [
      selectColumn,
      ...defined.map((column) => ({
        ...column,
        resizable: true,
        sortable: true,
        renderEditCell: column.editable ? renderTextEditor : undefined,
        cellClass: (row: GridRow) => peers.some((peer) => peer.focus?.kind === 'cell' && peer.focus.id === `${row.id}:${column.key}`) ? 'work-cell-remote' : undefined,
      })),
    ]
  }, [dataset, sheet, peers])

  const writeSheet = (rows: GridRow[], columns = sheet?.columns ?? []) => {
    const native: NativeSheet = {
      mode: 'sheet',
      columns,
      rows: rows.map((row) => ({ id: row.id, cells: Object.fromEntries(columns.map((column) => [column.id, row[column.id] ?? ''])) })),
    }
    change(doc.id, (current) => ({ ...current, sheet: native }))
  }

  const applyDataset = (row: GridRow, key: string, value: string) => {
    if (!dataset) return
    const current = getDatasetRows().find((item) => item.id === row.id)
    const result = dataset.edit({
      rowId: row.id,
      field: key,
      value,
      expectedVersion: current?.version ?? Number(row.version),
      idempotencyKey: crypto.randomUUID(),
      sourceDocumentId: doc.id,
    })
    if (result.status === 'updated') setRecordStatus('Updated')
    else if (result.status === 'conflict') setRecordStatus(`Conflict · now “${result.current.cells[key] ?? ''}” · yours “${result.proposed}”`)
    else setRecordStatus(result.message)
  }

  return (
    <div className="work-grid">
      <div className="work-bar">
        <input className="work-filter" aria-label="Filter rows" placeholder="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
        {sheet && <button type="button" onClick={() => writeSheet([...source, { id: crypto.randomUUID(), version: '0', ...Object.fromEntries(keys.map((key) => [key, ''])) }])}>Row</button>}
        {sheet && <button type="button" onClick={() => {
          const column = { id: crypto.randomUUID(), name: `Column ${sheet.columns.length + 1}` }
          writeSheet(source, [...sheet.columns, column])
        }}>Column</button>}
        {dataset && <span role="status">{recordStatus || contactsAdapter.description}</span>}
      </div>
      <DataGrid
        className="work-rdg"
        columns={columns}
        rows={shown}
        rowKeyGetter={(row) => row.id}
        sortColumns={sort}
        onSortColumnsChange={setSort}
        columnWidths={widths}
        onColumnWidthsChange={setWidths}
        selectedRows={selected}
        onSelectedRowsChange={setSelected}
        enableVirtualization
        onActivePositionChange={({ row, column }) => {
          if (!row || !column || column.key === SELECT_COLUMN_KEY) return
          notePresence({ activity: 'editing', focus: { kind: 'cell', id: `${row.id}:${column.key}` } })
        }}
        onCellCopy={({ row, column }, event) => {
          const picked = selected.size ? source.filter((item) => selected.has(item.id)) : [row]
          const text = picked.map((item) => keys.map((key) => item[key] ?? '').join('\t')).join('\n')
          const single = picked.length === 1 && !selected.size ? (row[column.key] ?? '') : text
          event.clipboardData.setData('text/plain', single)
          event.preventDefault()
        }}
        onCellPaste={({ row, column }, event) => {
          if (column.key === SELECT_COLUMN_KEY) return row
          const matrix = parseGrid(event.clipboardData.getData('text/plain'))
          event.preventDefault()
          const single = matrix.length <= 1 && (matrix[0]?.length ?? 0) <= 1
          const value = matrix[0]?.[0] ?? ''
          if (dataset) {
            if (single) applyDataset(row, column.key, value)
            else {
              const pasted = pasteMatrix(shown, keys, row.id, column.key, matrix)
              pasted.forEach((item, index) => {
                const before = shown[index]
                if (!before) return
                keys.forEach((key) => { if (item[key] !== before[key]) applyDataset(before, key, item[key] ?? '') })
              })
            }
            return row
          }
          if (single) return { ...row, [column.key]: value }
          writeSheet(mergeRows(source, pasteMatrix(shown, keys, row.id, column.key, matrix)))
          return row
        }}
        onFill={({ columnKey, sourceRow, targetRow }) => ({ ...targetRow, [columnKey]: sourceRow[columnKey] ?? '' })}
        onRowsChange={(next, data) => {
          if (data.column.key === SELECT_COLUMN_KEY) return
          if (dataset) {
            for (const index of data.indexes) {
              const row = next[index]
              const before = shown[index]
              if (!row || !before) continue
              const value = row[data.column.key] ?? ''
              if (value !== (before[data.column.key] ?? '')) applyDataset(before, data.column.key, value)
            }
            return
          }
          writeSheet(mergeRows(source, next))
        }}
      />
    </div>
  )
}
