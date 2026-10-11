import type { ImportBudgetRow } from '@project/sdk'
import {
  BUDGET_EXPENSE_CATEGORIES,
  BUDGET_INCOME_CATEGORIES,
  BUDGET_STATUS_LABELS,
} from '@project/shared'
import { parseCsv } from '../calendar/importParse'

export const BUDGET_IMPORT_MAX = 500

type Field = 'title' | 'date' | 'amount' | 'type' | 'category' | 'status' | 'notes'
const HEADERS: [Field, RegExp][] = [
  ['title', /^(title|name|item)$/],
  ['date', /^(date|day|scheduled ?date)$/],
  ['amount', /^(amount|value|total)$/],
  ['type', /^(type|direction|kind)$/],
  ['category', /^category$/],
  ['status', /^status$/],
  ['notes', /^(notes?|description|memo)$/],
]
const INCOME = /^(income|in|inflow|revenue)$/
const EXPENSE = /^(expense|expenses|out|outflow|cost|spend)$/

/**
 * Budget CSV → import rows. Required: title, date, amount. Type comes from a type column
 * or the amount's sign (negative = expense). Unknown categories become Other Income /
 * Other Expense; a missing status is Planned. Any bad row refuses the whole file.
 */
export function parseBudgetCsv(text: string): { items: ImportBudgetRow[] } | { error: string } {
  const rows = parseCsv(text.replace(/^﻿/, ''))
  if (!rows || rows.length < 2) return { error: 'Add a header row and at least one budget row.' }
  const [head, ...body] = rows
  const columns = head.map((name) => HEADERS.find(([, re]) => re.test(name.trim().toLowerCase()))?.[0] ?? null)
  const missing = (['title', 'date', 'amount'] as const).filter((f) => !columns.includes(f))
  if (missing.length) return { error: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` }
  if (body.length > BUDGET_IMPORT_MAX) return { error: `At most ${BUDGET_IMPORT_MAX} rows per import.` }

  const items: ImportBudgetRow[] = []
  for (const [index, row] of body.entries()) {
    const line = index + 2
    const cell = (f: Field) => (row[columns.indexOf(f)] ?? '').trim()
    const title = cell('title')
    if (!title) return { error: `Row ${line}: title is empty.` }
    const date = dateOf(cell('date'))
    if (!date) return { error: `Row ${line}: date "${cell('date')}" isn't YYYY-MM-DD or M/D/YYYY.` }
    const amount = amountOf(cell('amount'))
    if (amount == null) return { error: `Row ${line}: amount "${cell('amount')}" isn't a number.` }
    const typeText = cell('type').toLowerCase()
    const direction = INCOME.test(typeText) ? 'income' : EXPENSE.test(typeText) ? 'expense' : typeText ? null : amount < 0 ? 'expense' : 'income'
    if (!direction) return { error: `Row ${line}: type "${cell('type')}" should be income or expense.` }
    const statusText = cell('status').toLowerCase()
    const status = statusText ? (Object.keys(BUDGET_STATUS_LABELS).find((k) => k === statusText || (statusText === 'canceled' && k === 'cancelled')) as ImportBudgetRow['status']) : 'planned'
    if (!status) return { error: `Row ${line}: status "${cell('status')}" should be planned, pending, cleared or cancelled.` }
    const notes = cell('notes')
    items.push({
      title: title.slice(0, 255),
      direction,
      category: categoryOf(cell('category'), direction),
      amountMinor: Math.round(Math.abs(amount) * 100),
      scheduledDate: date,
      status,
      ...(notes ? { description: notes.slice(0, 2000) } : {}),
    })
  }
  return { items }
}

function dateOf(value: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : us ? [us[3], us[1], us[2]] : []
  if (!y || !m || !d) return null
  const out = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  const check = new Date(`${out}T00:00:00Z`)
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === out ? out : null
}

/** "$1,234.50", "-75", "(129.99)" → signed number. */
function amountOf(value: string): number | null {
  const negative = /^\(.*\)$/.test(value) || value.includes('-')
  const digits = value.replace(/[^0-9.]/g, '')
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(digits)) return null
  const n = Number(digits)
  return negative ? -n : n
}

function categoryOf(value: string, direction: 'income' | 'expense'): ImportBudgetRow['category'] {
  const list: Record<string, string> = direction === 'income' ? BUDGET_INCOME_CATEGORIES : BUDGET_EXPENSE_CATEGORIES
  const v = value.trim().toLowerCase()
  const key = Object.keys(list).find((k) => k === v || list[k].toLowerCase() === v)
  return (key ?? (direction === 'income' ? 'other_income' : 'other_expense')) as ImportBudgetRow['category']
}
