// Tasks as a CSV file, in the order the table shows them. Spreadsheet-safe: cells
// that would start a formula are prefixed with an apostrophe, and the file starts
// with a BOM so Excel reads UTF-8 names correctly.
import type { Workflow } from '@project/shared'
import type { CalTask } from './types'

const PRIORITY: Record<string, string> = { highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low' }
const TYPE: Record<string, string> = { task: 'Task', feature: 'Feature', bug: 'Bug', story: 'Story', epic: 'Epic' }

const HEADER = ['Key', 'Title', 'Status', 'Assignee', 'Priority', 'Type', 'Area', 'Story points', 'Due', 'Calendar date', 'Blocked', 'Updated']

export function csvCell(value: string | number | null | undefined): string {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function tasksCsv(rows: CalTask[], wf: Pick<Workflow, 'label'>): string {
  const lines = rows.map((t) => [
    t.taskKey,
    t.title,
    wf.label(t.status),
    t.assigneeName ?? '',
    PRIORITY[t.priority ?? 'medium'] ?? t.priority,
    TYPE[t.category ?? 'task'] ?? t.category,
    t.area ?? '',
    t.storyPoints ?? '',
    t.dueDate ?? '',
    t.day ?? '',
    t.blocked ? t.blocked.reason || 'Yes' : '',
    t.updatedAt ?? '',
  ].map(csvCell).join(','))
  return '﻿' + [HEADER.join(','), ...lines].join('\r\n') + '\r\n'
}

export function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
