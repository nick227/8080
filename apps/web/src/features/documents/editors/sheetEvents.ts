import type { ClipboardEvent } from 'react'
import type { CellCopyArgs, CellKeyDownArgs, CellKeyboardEvent, CellMouseArgs, CellMouseEvent, CellPasteArgs, FillEvent, RowsChangeData } from 'react-data-grid'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { bounds, copyText, parseGrid, pasteAt, writeRange, type CellIndex, type CellRange, type GridRow } from './gridRows'
import { ROW_KEY } from './SheetHeader'
import { notePresence } from '../presence'

let shiftHeld = false
let watchingShift = false

function watchShift() {
  if (watchingShift || typeof window === 'undefined') return
  watchingShift = true
  window.addEventListener('keydown', (event) => { if (event.key === 'Shift') shiftHeld = true })
  window.addEventListener('keyup', (event) => { if (event.key === 'Shift') shiftHeld = false })
  window.addEventListener('blur', () => { shiftHeld = false })
}

function shifted(event: object) {
  watchShift()
  const raw = event as { shiftKey?: boolean; nativeEvent?: { shiftKey?: boolean } }
  try {
    if (typeof raw.nativeEvent?.shiftKey === 'boolean') return raw.nativeEvent.shiftKey
    if (typeof raw.shiftKey === 'boolean') return raw.shiftKey
  } catch { /* the grid copies the event onto a plain object, so the getter throws */ }
  return shiftHeld
}

type Drag = { anchor: CellIndex; mode: 'cells' | 'rows'; extended: boolean }

export type SheetCtx = {
  keys: readonly string[]
  displayed: readonly GridRow[]
  indexOf: ReadonlyMap<string, number>
  dataset: boolean
  sheet: boolean
  rangeRef: RefObject<CellRange | null>
  drag: RefObject<Drag | null>
  hold: RefObject<boolean>
  shiftExtend: RefObject<boolean>
  grown: RefObject<number>
  place: (anchor: CellIndex, focus: CellIndex, focusCell?: boolean) => void
  setRange: Dispatch<SetStateAction<CellRange | null>>
  setTail: Dispatch<SetStateAction<number>>
  commit: (rows: readonly GridRow[]) => void
  applyDataset: (row: GridRow, key: string, value: string) => void
  setRecordStatus: (status: string) => void
}

export function sheetInteractions(ctx: SheetCtx) {
  const onCellMouseDown = ({ rowIdx, column }: CellMouseArgs<GridRow>, event: CellMouseEvent) => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('input, textarea')) return
    const shift = shifted(event)
    if (column.key === ROW_KEY) {
      const anchor = { row: shift && ctx.rangeRef.current ? ctx.rangeRef.current.anchor.row : rowIdx, col: 0 }
      ctx.place(anchor, { row: rowIdx, col: Math.max(0, ctx.keys.length - 1) }, false)
      ctx.drag.current = { anchor, mode: 'rows', extended: false }
      return
    }
    const col = ctx.keys.indexOf(column.key)
    if (col < 0) return
    const pos = { row: rowIdx, col }
    const anchor = shift && ctx.rangeRef.current ? ctx.rangeRef.current.anchor : pos
    ctx.place(anchor, pos, false)
    ctx.drag.current = { anchor, mode: 'cells', extended: false }
  }

  const onCellKeyDown = (_args: CellKeyDownArgs<GridRow>, event: CellKeyboardEvent) => {
    if (event.shiftKey && event.key.startsWith('Arrow')) {
      ctx.shiftExtend.current = true
      queueMicrotask(() => { ctx.shiftExtend.current = false })
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && ctx.keys.length && ctx.displayed.length) {
      event.preventGridDefault()
      event.preventDefault()
      ctx.setRange({ anchor: { row: 0, col: 0 }, focus: { row: ctx.displayed.length - 1, col: ctx.keys.length - 1 } })
      return
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    event.preventGridDefault()
    event.preventDefault()
    const selection = ctx.rangeRef.current
    if (!selection) return
    if (ctx.dataset) {
      const box = bounds(selection)
      const record = ctx.displayed[box.r0]
      const key = ctx.keys[box.c0]
      if (box.r0 === box.r1 && box.c0 === box.c1 && record && key) void ctx.applyDataset(record, key, '')
      return
    }
    ctx.commit(writeRange(ctx.displayed, ctx.keys, selection, ''))
  }

  const onActivePositionChange = ({ row, column, rowIdx }: { row: GridRow | undefined; column: { key: string } | undefined; rowIdx: number }) => {
    if (!row || !column || column.key === ROW_KEY) return
    const col = ctx.keys.indexOf(column.key)
    if (col < 0) return
    notePresence({ activity: 'editing', focus: { kind: 'cell', id: `${row.id}:${column.key}` } })
    if (ctx.sheet && rowIdx >= ctx.displayed.length - 1 && rowIdx > ctx.grown.current) {
      ctx.grown.current = rowIdx + 4
      ctx.setTail((count) => count + 4)
    }
    if (ctx.hold.current || ctx.drag.current) return
    if (ctx.shiftExtend.current) ctx.setRange((current) => ({ anchor: current?.anchor ?? { row: rowIdx, col }, focus: { row: rowIdx, col } }))
    else ctx.setRange({ anchor: { row: rowIdx, col }, focus: { row: rowIdx, col } })
  }

  const onCellCopy = ({ row, column }: CellCopyArgs<GridRow>, event: ClipboardEvent<HTMLDivElement>) => {
    const col = ctx.keys.indexOf(column.key)
    const rowIndex = ctx.indexOf.get(row.id) ?? -1
    const selection = ctx.rangeRef.current ?? (col >= 0 && rowIndex >= 0 ? { anchor: { row: rowIndex, col }, focus: { row: rowIndex, col } } : null)
    if (!selection) return
    event.clipboardData.setData('text/plain', copyText(ctx.displayed, ctx.keys, selection))
    event.preventDefault()
  }

  const onCellPaste = ({ row, column }: CellPasteArgs<GridRow>, event: ClipboardEvent<HTMLDivElement>) => {
    const matrix = parseGrid(event.clipboardData.getData('text/plain'))
    event.preventDefault()
    const selection = ctx.rangeRef.current
    const span = selection ? bounds(selection) : null
    let col = ctx.keys.indexOf(column.key)
    let rowIndex = ctx.indexOf.get(row.id) ?? -1
    if ((column.key === ROW_KEY || col < 0) && span) {
      rowIndex = span.r0
      col = span.c0
    }
    if (col < 0 || rowIndex < 0) return row
    const single = matrix.length <= 1 && (matrix[0]?.length ?? 0) <= 1
    const value = matrix[0]?.[0] ?? ''
    if (ctx.dataset) {
      const key = ctx.keys[col]
      const record = ctx.displayed[rowIndex]
      if (single && key && record) void ctx.applyDataset(record, key, value)
      else ctx.setRecordStatus('Paste one cell at a time into contacts')
      return row
    }
    const wide = !!span && single && (span.r0 !== span.r1 || span.c0 !== span.c1)
    const next = wide && selection ? writeRange(ctx.displayed, ctx.keys, selection, value) : pasteAt(ctx.displayed, ctx.keys, rowIndex, col, matrix.length ? matrix : [['']])
    ctx.commit(next)
    return row
  }

  const onFill = ({ columnKey, sourceRow, targetRow }: FillEvent<GridRow>) => ({ ...targetRow, [columnKey]: sourceRow[columnKey] ?? '' })

  const onRowsChange = (next: GridRow[], data: RowsChangeData<GridRow>) => {
    if (data.column.key === ROW_KEY) return
    if (ctx.dataset) {
      for (const index of data.indexes) {
        const edited = next[index]
        const before = ctx.displayed[index]
        if (!edited || !before) continue
        const value = edited[data.column.key] ?? ''
        if (value !== (before[data.column.key] ?? '')) void ctx.applyDataset(before, data.column.key, value)
      }
      return
    }
    ctx.commit(next)
  }

  return { onCellMouseDown, onCellKeyDown, onActivePositionChange, onCellCopy, onCellPaste, onFill, onRowsChange }
}
