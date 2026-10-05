import type { SortColumn } from 'react-data-grid'

export type GridRow = Record<string, string>

export function visibleRows(rows: readonly GridRow[], filter: string, sort: readonly SortColumn[]) {
  const query = filter.trim().toLowerCase()
  const filtered = query
    ? rows.filter((row) => Object.entries(row).some(([key, value]) => key !== 'id' && key !== 'version' && value.toLowerCase().includes(query)))
    : [...rows]
  const column = sort[0]
  if (!column) return filtered
  const dir = column.direction === 'ASC' ? 1 : -1
  return [...filtered].sort((a, b) => (a[column.columnKey] ?? '').localeCompare(b[column.columnKey] ?? '', undefined, { numeric: true }) * dir)
}

export function mergeRows(full: readonly GridRow[], shown: readonly GridRow[]) {
  const next = new Map(shown.map((row) => [row.id, row]))
  return full.map((row) => next.get(row.id) ?? row)
}

export function pasteMatrix(rows: readonly GridRow[], keys: readonly string[], startId: string, startKey: string, matrix: string[][]) {
  const startRow = rows.findIndex((row) => row.id === startId)
  const startCol = keys.indexOf(startKey)
  if (startRow < 0 || startCol < 0) return [...rows]
  return rows.map((row, rowIndex) => {
    const line = matrix[rowIndex - startRow]
    if (!line) return row
    const cells = { ...row }
    line.forEach((value, offset) => {
      const key = keys[startCol + offset]
      if (key) cells[key] = value
    })
    return cells
  })
}

export function parseGrid(text: string) {
  return text.split(/\r?\n/).filter((line) => line.length > 0).map((line) => line.split('\t'))
}
