/** Native spreadsheets (doc/13 §12, A2). One shape on the server and in the browser:
 *  typed columns, raw cell values kept apart from how they are shown, and totals that
 *  are always computed — never stored, never written by a model. No formulas.
 *
 *  Raw values: text → string · number → finite number · money → integer minor units
 *  (cents) in the column's currency · date → "YYYY-MM-DD" · boolean → true/false.
 *  An empty cell is null (or absent). */

export const CELL_TYPES = ['text', 'number', 'money', 'date', 'boolean'] as const
export type CellType = typeof CELL_TYPES[number]
export type CellValue = string | number | boolean | null

export type SheetColumnDef = {
  id: string
  label: string
  type: CellType
  /** money only: ISO 4217 code. */
  currency?: string
  /** number/money only: show the column's sum under the rows. */
  total?: 'sum'
}
export type SheetContent = {
  schemaVersion: 1
  columns: SheetColumnDef[]
  rows: { id: string; cells: Record<string, CellValue> }[]
}

export const SHEET_LIMITS = { columns: 100, rows: 5000, text: 5000, bytes: 950_000 } as const

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
export function isDay(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = DAY.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!))
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!
}

/** Digits after the decimal point for a currency (USD 2, JPY 0). */
export function minorDigits(currency: string) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2 } catch { return 2 }
}
export const isCurrency = (c: unknown): c is string => typeof c === 'string' && /^[A-Z]{3}$/.test(c) && (() => { try { new Intl.NumberFormat('en-US', { style: 'currency', currency: c }); return true } catch { return false } })()

/** Whether a raw value fits its column's type. */
export function validValue(type: CellType, v: CellValue): boolean {
  if (v === null) return true
  switch (type) {
    case 'text': return typeof v === 'string' && v.length <= SHEET_LIMITS.text
    case 'number': return typeof v === 'number' && Number.isFinite(v)
    case 'money': return typeof v === 'number' && Number.isSafeInteger(v)
    case 'date': return isDay(v)
    case 'boolean': return typeof v === 'boolean'
  }
}

const TAKES: Record<CellType, string> = {
  text: `text of at most ${SHEET_LIMITS.text} characters`, number: 'numbers', money: 'whole minor units (cents)', date: 'dates as YYYY-MM-DD', boolean: 'true or false',
}

/** Problems with a sheet, or null. Unknown fields and cells are problems, not ignored. */
export function sheetProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'A sheet is an object'
  const s = raw as Record<string, unknown>
  if (Object.keys(s).some((k) => !['schemaVersion', 'columns', 'rows'].includes(k))) return 'Unknown sheet field'
  if (JSON.stringify(s).length > SHEET_LIMITS.bytes) return 'The sheet is too large to save'
  if (s.schemaVersion !== 1) return 'Unsupported sheet version'
  if (!Array.isArray(s.columns) || s.columns.length > SHEET_LIMITS.columns) return `A sheet has at most ${SHEET_LIMITS.columns} columns`
  if (!Array.isArray(s.rows) || s.rows.length > SHEET_LIMITS.rows) return `A sheet has at most ${SHEET_LIMITS.rows} rows`
  const cols = new Map<string, SheetColumnDef>()
  for (const c of s.columns as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object' || Object.keys(c).some((k) => !['id', 'label', 'type', 'currency', 'total'].includes(k))) return 'Unknown column field'
    if (typeof c.id !== 'string' || !c.id || c.id.length > 64 || cols.has(c.id)) return 'Each column needs a unique id'
    if (typeof c.label !== 'string' || c.label.length > 200) return 'Column names are at most 200 characters'
    if (!CELL_TYPES.includes(c.type as CellType)) return 'Unknown column type'
    if (c.type === 'money' ? !isCurrency(c.currency) : c.currency !== undefined) return 'A money column needs a currency; other columns have none'
    if (c.total !== undefined && (c.total !== 'sum' || !['number', 'money'].includes(c.type as string))) return 'Only number and money columns have totals'
    cols.set(c.id, c as unknown as SheetColumnDef)
  }
  const rows = new Set<string>()
  for (const r of s.rows as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || Object.keys(r).some((k) => !['id', 'cells'].includes(k))) return 'Unknown row field'
    if (typeof r.id !== 'string' || !r.id || r.id.length > 64 || rows.has(r.id)) return 'Each row needs a unique id'
    rows.add(r.id)
    if (!r.cells || typeof r.cells !== 'object' || Array.isArray(r.cells)) return 'Row cells are an object'
    for (const [k, v] of Object.entries(r.cells as Record<string, unknown>)) {
      const col = cols.get(k)
      if (!col) return 'A cell names an unknown column'
      if (!validValue(col.type, v as CellValue)) return `“${col.label || col.id}” takes ${TAKES[col.type]}`
    }
  }
  return null
}

// ─── text in, text out ────────────────────────────────────────────────────────

/** The plain text a person edits (and copies): parseCell reads it back exactly. */
export function cellText(col: Pick<SheetColumnDef, 'type' | 'currency'>, v: CellValue | undefined): string {
  if (v === null || v === undefined) return ''
  switch (col.type) {
    case 'money': { const d = minorDigits(col.currency ?? 'USD'); return ((v as number) / 10 ** d).toFixed(d) }
    case 'boolean': return v ? 'Yes' : 'No'
    default: return String(v)
  }
}

export type Parsed = { ok: true; value: CellValue } | { ok: false; why: string }

/** What a person typed or pasted → a raw value of the column's type, or why not. */
export function parseCell(col: Pick<SheetColumnDef, 'type' | 'currency'>, input: string): Parsed {
  const t = input.trim()
  if (!t) return { ok: true, value: null }
  switch (col.type) {
    case 'text': return input.length <= SHEET_LIMITS.text ? { ok: true, value: input } : { ok: false, why: 'is too long' }
    case 'number': {
      const n = t.replace(/[,\s]/g, '')
      return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(n) && Number.isFinite(Number(n)) ? { ok: true, value: Number(n) } : { ok: false, why: 'isn’t a number' }
    }
    case 'money': {
      // "1,250.50", "$1250.5", "-12", "(12.00)", "USD 40" — symbols and codes are dropped.
      let m = t.replace(/[,\s]/g, '')
      let neg = false
      if (/^\(.*\)$/.test(m)) { neg = true; m = m.slice(1, -1) }
      m = m.replace(/^([A-Z]{3}|[$€£¥])/, '')
      if (m.startsWith('-')) { neg = !neg; m = m.slice(1) }
      m = m.replace(/^([A-Z]{3}|[$€£¥])/, '').replace(/([A-Z]{3}|[$€£¥])$/, '')
      if (!/^(\d+\.?\d*|\.\d+)$/.test(m)) return { ok: false, why: 'isn’t an amount' }
      const d = minorDigits(col.currency ?? 'USD')
      const [whole = '', frac = ''] = m.split('.')
      if (frac.length > d) return { ok: false, why: d ? `has more than ${d} decimal places` : 'has decimals' }
      const minor = Number(whole || '0') * 10 ** d + Number(frac.padEnd(d, '0') || '0')
      return Number.isSafeInteger(minor) ? { ok: true, value: neg && minor ? -minor : minor } : { ok: false, why: 'is too large' }
    }
    case 'date': {
      if (isDay(t)) return { ok: true, value: t }
      const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
      const day = us ? `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}` : null
      return day && isDay(day) ? { ok: true, value: day } : { ok: false, why: 'isn’t a date (use YYYY-MM-DD)' }
    }
    case 'boolean': {
      const b = t.toLowerCase()
      if (['yes', 'y', 'true', '1', 'x', '✓'].includes(b)) return { ok: true, value: true }
      if (['no', 'n', 'false', '0'].includes(b)) return { ok: true, value: false }
      return { ok: false, why: 'isn’t yes or no' }
    }
  }
}

/** How a value is shown (formatted); cellText is what is edited. */
export function formatCell(col: Pick<SheetColumnDef, 'type' | 'currency'>, v: CellValue | undefined): string {
  if (v === null || v === undefined) return ''
  switch (col.type) {
    case 'number': return new Intl.NumberFormat('en-US', { maximumFractionDigits: 10 }).format(v as number)
    case 'money': { const c = col.currency ?? 'USD'; const d = minorDigits(c); return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format((v as number) / 10 ** d) }
    case 'date': return new Date(`${v}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    case 'boolean': return v ? 'Yes' : 'No'
    default: return String(v)
  }
}

/** Sums for the columns that show one, computed from the raw values (money stays exact). */
export function sheetTotals(sheet: SheetContent): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of sheet.columns) {
    if (c.total !== 'sum') continue
    let sum = 0
    for (const r of sheet.rows) { const v = r.cells[c.id]; if (typeof v === 'number') sum += v }
    out[c.id] = c.type === 'money' ? Math.round(sum) : Number(sum.toPrecision(15))
  }
  return out
}

/** Every value of a column converted to another type: the new values, or the cells that don't fit. */
export function convertColumn(sheet: SheetContent, columnId: string, to: Pick<SheetColumnDef, 'type' | 'currency'>) {
  const from = sheet.columns.find((c) => c.id === columnId)
  if (!from) return { ok: false as const, bad: [] as string[] }
  const values = new Map<string, CellValue>()
  const bad: string[] = []
  for (const r of sheet.rows) {
    const p = parseCell(to, cellText(from, r.cells[columnId]))
    if (p.ok) values.set(r.id, p.value)
    else bad.push(r.id)
  }
  return bad.length ? { ok: false as const, bad } : { ok: true as const, values }
}

/** A text-only table (CSV import, A1 snapshot) as a sheet of text columns. */
export function sheetFromText(table: { columns: { id: string; label: string }[]; rows: { id: string; cells: Record<string, string | null> }[] }): SheetContent {
  return {
    schemaVersion: 1,
    columns: table.columns.map((c) => ({ id: c.id, label: c.label, type: 'text' })),
    rows: table.rows.map((r) => ({ id: r.id, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, v === '' ? null : v])) })),
  }
}

/** The shown text of every cell plus a Total line — for CSV, snapshots and previews. */
export function sheetAsText(sheet: SheetContent) {
  const totals = sheetTotals(sheet)
  const rows = sheet.rows.map((r) => ({ id: r.id, cells: Object.fromEntries(sheet.columns.map((c) => [c.id, cellText(c, r.cells[c.id])])) }))
  if (Object.keys(totals).length) {
    const first = sheet.columns.find((c) => !(c.id in totals))
    rows.push({ id: 'total', cells: Object.fromEntries(sheet.columns.map((c) => [c.id, c.id in totals ? cellText(c, totals[c.id]!) : c === first ? 'Total' : ''])) })
  }
  return { columns: sheet.columns.map((c) => ({ id: c.id, label: c.label, type: 'text' as const })), rows }
}
