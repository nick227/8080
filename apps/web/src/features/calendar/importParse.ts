import { cleanTime, NOON, parseDayKey } from './dates'
import type { CalTask } from './types'

export type ImportedTask = Pick<CalTask, 'title' | 'day' | 'time' | 'status'>

const TITLE = /^(task|title|note|name)$/i
const DATE = /^(date|day)$/i
const TIME = /^(time|hour)$/i
const STATUS = /^status$/i
const DONE = /^(done|closed|complete|completed)$/i
const OPEN = /^(open|todo|pending)$/i

type Parsed = { tasks: ImportedTask[] } | { error: string }

export function parseTaskList(text: string, day: string): Parsed {
  const titles = text.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean)
  if (!titles.length) return { error: 'Paste a list of tasks.' }
  return { tasks: titles.map((title) => ({ title, day, time: NOON, status: 'open' })) }
}

export function parseTaskCsv(text: string): Parsed {
  const rows = parseCsv(text.replace(/^\uFEFF/, '').trim())
  if (!rows) return { error: 'That CSV is not valid.' }
  const header = rows[0]
  if (!header) return { error: 'CSV needs title and date columns.' }
  const columns: Column[] = []
  for (const name of header) {
    const kind = columnKind(name)
    if (!kind) return { error: `Unknown column "${name.trim() || 'blank'}". Use title, date, time, and status.` }
    columns.push(kind)
  }
  if (!columns.includes('title') || !columns.includes('date')) return { error: 'CSV needs title and date columns.' }
  if (new Set(columns).size !== columns.length) return { error: 'Each column name can only be used once.' }
  const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim()))
  if (!body.length) return { error: 'CSV has no tasks.' }
  const tasks: ImportedTask[] = []
  for (let index = 0; index < body.length; index++) {
    const row = body[index]
    if (!row) continue
    const line = index + 2
    if (row.length !== header.length) return { error: `Row ${line} has ${row.length} columns and the header has ${header.length}.` }
    const task = taskFrom(row, columns, line)
    if ('error' in task) return task
    tasks.push(task)
  }
  return { tasks }
}

function taskFrom(row: string[], columns: Column[], line: number): ImportedTask | { error: string } {
  const cell = (kind: Column) => row[columns.indexOf(kind)]?.trim() ?? ''
  const title = cell('title')
  if (!title) return { error: `Row ${line} needs a title.` }
  const day = parseDayKey(cell('date'))
  if (!day) return { error: `Row ${line} needs a valid date.` }
  const rawTime = columns.includes('time') ? cell('time') : ''
  const time = rawTime ? cleanTime(rawTime) : NOON
  if (!time) return { error: `Row ${line} needs a valid time.` }
  const rawStatus = columns.includes('status') ? cell('status') : ''
  const status = rawStatus ? statusOf(rawStatus) : 'open'
  if (!status) return { error: `Row ${line} needs a valid status.` }
  return { title, day, time, status }
}

type Column = 'title' | 'date' | 'time' | 'status'

function columnKind(name: string): Column | null {
  const text = name.trim()
  if (TITLE.test(text)) return 'title'
  if (DATE.test(text)) return 'date'
  if (TIME.test(text)) return 'time'
  if (STATUS.test(text)) return 'status'
  return null
}

function statusOf(value: string): 'open' | 'done' | null {
  if (DONE.test(value)) return 'done'
  if (OPEN.test(value)) return 'open'
  return null
}

function parseCsv(text: string): string[][] | null {
  if (!text) return null
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === ',') { row.push(cell); cell = ''; continue }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((item) => item.trim())) rows.push(row)
      row = []
      continue
    }
    cell += char
  }
  if (quoted) return null
  row.push(cell)
  if (row.some((item) => item.trim())) rows.push(row)
  return rows
}
