import { useEffect, useRef, type RefObject } from 'react'
import type { CellIndex } from './gridRows'

type Drag = { anchor: CellIndex; mode: 'cells' | 'rows'; extended: boolean }

export function useGridDrag(
  view: RefObject<{ rows: number; cols: number }>,
  onRange: (anchor: CellIndex, focus: CellIndex) => void,
  onEdge: () => void,
) {
  const drag = useRef<Drag | null>(null)
  const rangeRef = useRef(onRange)
  const edgeRef = useRef(onEdge)
  rangeRef.current = onRange
  edgeRef.current = onEdge
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = drag.current
      if (!current || event.buttons === 0) {
        drag.current = null
        return
      }
      nudgeGrid(event.clientX, event.clientY)
      const hit = hitCell(event.clientX, event.clientY)
      const size = view.current
      if (!size) return
      const { rows, cols } = size
      if (!hit || rows < 1 || cols < 1) return
      const row = Math.min(hit.row, rows - 1)
      if (row >= rows - 1 && !current.extended) {
        current.extended = true
        edgeRef.current()
      }
      if (current.mode === 'rows') rangeRef.current({ row: current.anchor.row, col: 0 }, { row, col: cols - 1 })
      else rangeRef.current(current.anchor, { row, col: Math.max(0, hit.gridCol - 1) })
    }
    const up = () => { drag.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [view])
  return drag
}

export function hitCell(x: number, y: number) {
  const node = document.elementFromPoint(x, y)
  if (!(node instanceof Element)) return null
  const cell = node.closest('.rdg-cell')
  if (!(cell instanceof HTMLElement)) return null
  const rowNode = cell.closest('[role="row"]')
  if (!(rowNode instanceof HTMLElement) || rowNode.classList.contains('rdg-header-row')) return null
  const ariaRow = Number(rowNode.getAttribute('aria-rowindex'))
  const ariaCol = Number(cell.getAttribute('aria-colindex'))
  if (!Number.isInteger(ariaRow) || !Number.isInteger(ariaCol) || ariaRow < 2 || ariaCol < 1) return null
  return { row: ariaRow - 2, gridCol: ariaCol - 1 }
}

export function nudgeGrid(x: number, y: number) {
  const grid = document.querySelector('.work-rdg')
  if (!(grid instanceof HTMLElement)) return
  const rect = grid.getBoundingClientRect()
  if (y > rect.bottom - 28) grid.scrollTop += 24
  else if (y < rect.top + 40) grid.scrollTop -= 24
  if (x > rect.right - 28) grid.scrollLeft += 24
  else if (x < rect.left + 56) grid.scrollLeft -= 24
}
