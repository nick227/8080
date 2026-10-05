import type { GridTable } from '@project/shared'
import { badRequest } from '../lib/errors'

// Bounded RFC4180-style UTF-8 text import. No type guessing: identifiers stay text.
export function parseDocumentCsv(text: string): GridTable {
  if (Buffer.byteLength(text) > 500_000) throw badRequest('CSV exceeds 500 KB', 'CSV_LIMIT')
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let closed = false
  const pushCell = () => { row.push(cell); cell = ''; closed = false; if (row.length > 100) throw badRequest('At most 100 columns', 'CSV_LIMIT') }
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > 5001) throw badRequest('At most 5000 data rows', 'CSV_LIMIT') }
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true } }
      else cell += c
    } else if (c === ',') pushCell()
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow() }
    else if (c === '"' && !cell && !closed) quoted = true
    else { if (closed || c === '"') throw badRequest('Malformed CSV quoting', 'INVALID_CSV'); cell += c }
  }
  if (quoted) throw badRequest('Unclosed quoted CSV field', 'INVALID_CSV')
  if (cell || row.length || closed) pushRow()
  const headers = rows.shift()
  if (!headers?.length || headers.some(h => !h.trim()) || new Set(headers).size !== headers.length) throw badRequest('CSV needs nonempty unique headers', 'INVALID_CSV')
  if (headers.some(h => h.length > 200) || rows.some(r => r.length !== headers.length)) throw badRequest('CSV header too long or row width mismatch', 'INVALID_CSV')
  if (rows.length * headers.length > 20000) throw badRequest('At most 20000 cells', 'CSV_LIMIT')
  const columns = headers.map((label, i) => ({ id: `c${i + 1}`, label, type: 'text' as const }))
  return { columns, rows: rows.map((r, i) => ({ id: `r${i + 1}`, cells: Object.fromEntries(columns.map((c, j) => [c.id, r[j]!])) })) }
}
export function renderCsv(headers: string[], rows: (string | null)[][]) {
  const escape = (value: string | null) => {
    let text = value ?? ''
    // Text exports must remain text in spreadsheet programs, including leading whitespace.
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text
    return '"' + text.replace(/"/g, '""') + '"'
  }
  return [headers, ...rows].map(r => r.map(escape).join(',')).join('\r\n') + '\r\n'
}
