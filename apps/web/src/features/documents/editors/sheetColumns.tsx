import { renderTextEditor, type Column, type SortColumn } from 'react-data-grid'
import type { CellRange, GridRow } from './gridRows'
import { bounds, covers } from './gridRows'
import { CornerCell, ROW_KEY, SheetHeader } from './SheetHeader'

export const ROW_HEIGHT = 35
export const HEADER_HEIGHT = 35

type Defined = { key: string; name: string; editable: boolean }

type BuildArgs = {
  defined: readonly Defined[]
  indexOf: ReadonlyMap<string, number>
  range: CellRange | null
  rowCount: number
  sort: readonly SortColumn[]
  rename: boolean
  remoteIds: ReadonlySet<string>
  onSelectAll: () => void
  onSelectColumn: (col: number) => void
  onRename: (key: string, name: string) => void
  onDelete: (key: string) => void
  onSort: (key: string) => void
}

function marked(range: CellRange | null, row: number, col: number, remote: boolean) {
  const classes = [range && covers(range, row, col) ? 'work-cell-range' : '', remote ? 'work-cell-remote' : '']
  return classes.filter(Boolean).join(' ') || undefined
}

export function buildSheetColumns({ defined, indexOf, range, rowCount, sort, rename, remoteIds, onSelectAll, onSelectColumn, onRename, onDelete, onSort }: BuildArgs): Column<GridRow>[] {
  const gutter: Column<GridRow> = {
    key: ROW_KEY,
    name: '',
    width: 52,
    minWidth: 52,
    frozen: true,
    resizable: false,
    editable: false,
    cellClass: (row) => {
      const rowIdx = indexOf.get(row.id)
      const inside = range && rowIdx != null && rowIdx >= bounds(range).r0 && rowIdx <= bounds(range).r1
      return inside ? 'work-rownum is-in' : 'work-rownum'
    },
    headerCellClass: 'work-rownum',
    renderHeaderCell: () => <CornerCell onSelect={onSelectAll} />,
    renderCell: ({ rowIdx }) => rowIdx + 1,
  }
  const data = defined.map((column, col) => {
    const direction = sort.find((item) => item.columnKey === column.key)?.direction
    const box = range ? bounds(range) : null
    const selected = !!box && box.c0 <= col && box.c1 >= col && box.r0 === 0 && box.r1 === rowCount - 1 && rowCount > 0
    return {
      key: column.key,
      name: column.name,
      minWidth: 128,
      resizable: true,
      editable: column.editable,
      renderEditCell: column.editable ? renderTextEditor : undefined,
      renderHeaderCell: () => (
        <SheetHeader
          name={column.name}
          selected={selected}
          sort={direction}
          editable={rename}
          onSelect={() => onSelectColumn(col)}
          onRename={(name) => onRename(column.key, name)}
          onSort={() => onSort(column.key)}
          onDelete={() => onDelete(column.key)}
        />
      ),
      cellClass: (row: GridRow) => marked(range, indexOf.get(row.id) ?? -1, col, remoteIds.has(`${row.id}:${column.key}`)),
    } satisfies Column<GridRow>
  })
  return [gutter, ...data]
}
