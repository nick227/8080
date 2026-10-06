import type { DocumentRecord } from '../documents/types'

const TITLE = /task|title|note|name/i
const STATUS = /status/i
const CLOSED = /^(done|closed|complete|completed)$/i

export type TaskSheet = { id: string; title: string; tasks: string[] }

export function taskSheets(docs: DocumentRecord[]): TaskSheet[] {
  return docs.flatMap((doc) => {
    const tasks = titlesOf(doc)
    return tasks.length ? [{ id: doc.id, title: doc.title, tasks }] : []
  })
}

export function titlesOf(doc: DocumentRecord): string[] {
  if (doc.surface !== 'grid' || doc.sheet?.mode !== 'sheet') return []
  const columns = doc.sheet.columns
  const title = columns.find((column) => TITLE.test(column.name)) ?? columns[0]
  if (!title) return []
  const status = columns.find((column) => STATUS.test(column.name))
  return doc.sheet.rows.flatMap((row) => {
    const value = String(row.cells[title.id] ?? '').trim()
    if (!value) return []
    const mark = status ? String(row.cells[status.id] ?? '').trim() : ''
    return CLOSED.test(mark) ? [] : [value]
  })
}
