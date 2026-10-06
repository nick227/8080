import type { CellValue, SheetContent } from '@project/shared'
import type { NativeSheet, SheetColumn } from './types'

// The editor's sheet ↔ the server's typed SheetContent (doc/13 §12, A2). A column
// with no type is text (sheets made before A2 and device-local ones).

export const typeOf = (column: SheetColumn) => column.type ?? 'text'

export function toContent(sheet: NativeSheet): SheetContent {
  return {
    schemaVersion: 1,
    columns: sheet.columns.map((c) => ({
      id: c.id, label: c.name, type: typeOf(c),
      ...(typeOf(c) === 'money' ? { currency: c.currency ?? 'USD' } : {}),
      ...(c.total === 'sum' && ['number', 'money'].includes(typeOf(c)) ? { total: 'sum' as const } : {}),
    })),
    rows: sheet.rows.map((r) => ({
      id: r.id,
      cells: Object.fromEntries(sheet.columns.flatMap((c) => {
        const v = r.cells[c.id]
        return v === undefined || v === '' || v === null ? [] : [[c.id, v]]
      })),
    })),
  }
}

export function fromContent(content: SheetContent): NativeSheet {
  return {
    mode: 'sheet',
    columns: content.columns.map((c) => ({ id: c.id, name: c.label, type: c.type, ...(c.currency ? { currency: c.currency } : {}), ...(c.total ? { total: c.total } : {}) })),
    rows: content.rows.map((r) => ({ id: r.id, cells: { ...r.cells } })),
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Three-way merge by id: this browser's changes since `base` onto `remote`, cell by
 *  cell. Different cells (or rows, or columns) both survive; where both people changed
 *  the same cell, theirs is kept and counted. Remote order wins. */
export function rebaseSheet(base: SheetContent, local: SheetContent, remote: SheetContent) {
  let conflicts = 0
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]))

  const [bc, lc] = [byId(base.columns), byId(local.columns)]
  const columns: SheetContent['columns'] = []
  for (const r of remote.columns) {
    const b = bc.get(r.id)
    const l = lc.get(r.id)
    if (!b) { columns.push(r); continue }
    if (!l) { if (same(b, r)) continue; columns.push(r); conflicts++; continue } // deleted here, changed there
    if (same(l, b) || same(l, r)) columns.push(r)
    else if (same(r, b)) columns.push(l)
    else { columns.push(r); conflicts++ }
  }
  local.columns.forEach((l) => { if (!bc.has(l.id) && !columns.some((c) => c.id === l.id)) columns.push(l) })
  const kept = new Set(columns.map((c) => c.id))

  const [br, lr] = [byId(base.rows), byId(local.rows)]
  const rows: SheetContent['rows'] = []
  for (const r of remote.rows) {
    const b = br.get(r.id)
    const l = lr.get(r.id)
    if (!b) { rows.push(r); continue }
    if (!l) { if (same(b, r)) continue; rows.push(r); conflicts++; continue }
    const cells: Record<string, CellValue> = {}
    for (const key of new Set([...Object.keys(b.cells), ...Object.keys(l.cells), ...Object.keys(r.cells)])) {
      const [bv, lv, rv] = [b.cells[key], l.cells[key], r.cells[key]]
      const v = same(lv, bv) || same(lv, rv) ? rv : same(rv, bv) ? lv : (conflicts++, rv)
      if (v !== undefined && v !== null) cells[key] = v
    }
    rows.push({ id: r.id, cells })
  }
  local.rows.forEach((l, i) => {
    if (br.has(l.id) || rows.some((x) => x.id === l.id)) return
    const prev = local.rows.slice(0, i).reverse().find((p) => rows.some((x) => x.id === p.id))
    rows.splice(prev ? rows.findIndex((x) => x.id === prev.id) + 1 : rows.length, 0, l)
  })
  // Cells of columns that no longer exist go with them (copies: inputs stay untouched).
  const clean = rows.map((row) => ({ id: row.id, cells: Object.fromEntries(Object.entries(row.cells).filter(([key]) => kept.has(key))) }))
  return { merged: { schemaVersion: 1 as const, columns, rows: clean }, conflicts }
}
