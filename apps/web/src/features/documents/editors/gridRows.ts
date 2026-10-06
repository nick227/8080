import type { SortColumn } from 'react-data-grid'

export type GridRow = Record<string, string>

export type CellIndex = { row: number; col: number }

export type CellRange = { anchor: CellIndex; focus: CellIndex }

const PAD = 'pad:'

export function isPadId(id: string) {
  return id.startsWith(PAD)
}

export function bounds(range: CellRange) {
  return {
    r0: Math.min(range.anchor.row, range.focus.row),
    r1: Math.max(range.anchor.row, range.focus.row),
    c0: Math.min(range.anchor.col, range.focus.col),
    c1: Math.max(range.anchor.col, range.focus.col),
  }
}

export function covers(range: CellRange, row: number, col: number) {
  const box = bounds(range)
  return row >= box.r0 && row <= box.r1 && col >= box.c0 && col <= box.c1
}

/** `numeric` columns (typed number/money sheets) sort by value, blanks last. */
export function visibleRows(rows: readonly GridRow[], filter: string, sort: readonly SortColumn[], numeric: (key: string) => boolean = () => false) {
  const query = filter.trim().toLowerCase()
  const filtered = query
    ? rows.filter((row) => Object.entries(row).some(([key, value]) => key !== 'id' && key !== 'version' && value.toLowerCase().includes(query)))
    : [...rows]
  const column = sort[0]
  if (!column) return filtered
  const dir = column.direction === 'ASC' ? 1 : -1
  if (numeric(column.columnKey)) {
    const value = (row: GridRow) => { const text = (row[column.columnKey] ?? '').replace(/[^\d.eE+-]/g, ''); return text ? Number(text) : NaN }
    return [...filtered].sort((a, b) => {
      const [x, y] = [value(a), value(b)]
      if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) === Number.isNaN(y) ? 0 : Number.isNaN(x) ? 1 : -1
      return (x - y) * dir
    })
  }
  return [...filtered].sort((a, b) => (a[column.columnKey] ?? '').localeCompare(b[column.columnKey] ?? '', undefined, { numeric: true }) * dir)
}

export function blankCells(keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, '']))
}

export function padRows(rows: readonly GridRow[], keys: readonly string[], count: number) {
  if (rows.length >= count) return [...rows]
  const blanks = blankCells(keys)
  const next = [...rows]
  for (let index = rows.length; index < count; index++) next.push({ id: `${PAD}${index}`, version: '0', ...blanks })
  return next
}

function filled(row: GridRow, keys: readonly string[]) {
  return keys.some((key) => (row[key] ?? '') !== '')
}

/** Drop unused screen-filler rows. A filler the user typed in stays, with the blank rows above it, so the value does not jump. */
export function commitSheetRows(rows: readonly GridRow[], keys: readonly string[]) {
  let last = -1
  rows.forEach((row, index) => {
    if (!isPadId(row.id) || filled(row, keys)) last = index
  })
  if (last < 0) return []
  return rows.slice(0, last + 1).map((row) => (isPadId(row.id) ? { ...row, id: crypto.randomUUID() } : row))
}

export function applyDisplayed(source: readonly GridRow[], displayed: readonly GridRow[], keys: readonly string[]) {
  const byId = new Map(displayed.map((row) => [row.id, row]))
  const merged = source.map((row) => byId.get(row.id) ?? row)
  const extras = displayed.filter((row) => isPadId(row.id))
  return commitSheetRows([...merged, ...extras], keys)
}

export function writeRange(rows: readonly GridRow[], keys: readonly string[], range: CellRange, value: string) {
  const box = bounds(range)
  const next = padRows(rows, keys, box.r1 + 1).map((row) => ({ ...row }))
  for (let rowIndex = box.r0; rowIndex <= box.r1; rowIndex++) {
    const row = next[rowIndex]
    if (!row) continue
    for (let colIndex = box.c0; colIndex <= box.c1; colIndex++) {
      const key = keys[colIndex]
      if (key) row[key] = value
    }
  }
  return next
}

export function pasteAt(rows: readonly GridRow[], keys: readonly string[], startRow: number, startCol: number, matrix: readonly (readonly string[])[]) {
  const height = matrix.length ? startRow + matrix.length : rows.length
  const next = padRows(rows, keys, height).map((row) => ({ ...row }))
  matrix.forEach((line, rowOffset) => {
    const row = next[startRow + rowOffset]
    if (!row) return
    line.forEach((value, colOffset) => {
      const key = keys[startCol + colOffset]
      if (key) row[key] = value
    })
  })
  return next
}

export function copyText(rows: readonly GridRow[], keys: readonly string[], range: CellRange) {
  const box = bounds(range)
  const lines: string[] = []
  for (let rowIndex = box.r0; rowIndex <= box.r1; rowIndex++) {
    const cells: string[] = []
    for (let colIndex = box.c0; colIndex <= box.c1; colIndex++) cells.push(rows[rowIndex]?.[keys[colIndex] ?? ''] ?? '')
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}

export function parseGrid(text: string) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  if (!body) return []
  return body.split('\n').map((line) => line.split('\t'))
}
