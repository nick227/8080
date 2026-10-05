const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function todayKey(): string {
  return dayKey(new Date())
}

export function parseDay(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function addDays(date: Date, count: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + count)
  return next
}

export function shiftMonthKey(key: string, delta: number): string {
  const date = parseDay(key)
  return dayKey(new Date(date.getFullYear(), date.getMonth() + delta, 1))
}

export function monthName(key: string): string {
  return parseDay(key).toLocaleDateString('en-US', { month: 'long' })
}

export function weekdayName(key: string): string {
  return parseDay(key).toLocaleDateString('en-US', { weekday: 'long' })
}

export function dayTitle(key: string): string {
  return parseDay(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function shortDay(key: string): string {
  const date = parseDay(key)
  return `${date.toLocaleDateString('en-US', { weekday: 'long' })} ${date.getDate()}`
}

export type MonthCell = { key: string; inMonth: boolean }

export function monthCells(key: string): MonthCell[] {
  const date = parseDay(key)
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const start = addDays(first, -first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const cell = addDays(start, index)
    return { key: dayKey(cell), inMonth: cell.getMonth() === date.getMonth() }
  })
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7)
}

export const NOON = '12:00'

export function hourLabel(time: string): string {
  const [rawHour, rawMinute] = time.split(':')
  const hour = Number(rawHour)
  const minute = Number(rawMinute)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return time
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const clock = hour % 12 || 12
  const mins = Number.isInteger(minute) ? String(minute).padStart(2, '0') : '00'
  return `${clock}:${mins} ${suffix}`
}

export const HOURS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, '0')}:00`
  return { value, label: hourLabel(value) }
})

export function cleanTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const suffix = match[3]?.toLowerCase()
  if (suffix === 'pm' && hour < 12) hour += 12
  if (suffix === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  if (!suffix && !match[2] && hour > 23) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function parseDayKey(input: string, from = new Date()): string | null {
  const text = input.trim()
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return validDay(Number(iso[2]), Number(iso[3]), Number(iso[1]))
  return parseSpokenDay(text, from)
}

export function parseSpokenDay(input: string, from = new Date()): string | null {
  const text = input.trim().toLowerCase().replace(/,/g, '')
  if (!text) return null
  if (text === 'today') return dayKey(from)
  if (text === 'tomorrow') return dayKey(addDays(from, 1))
  if (text === 'yesterday') return dayKey(addDays(from, -1))
  const weekday = WEEKDAYS.indexOf(text)
  if (weekday >= 0) {
    const delta = (weekday - from.getDay() + 7) % 7
    return dayKey(addDays(from, delta))
  }
  const numeric = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (numeric) return validDay(Number(numeric[1]), Number(numeric[2]), yearOf(numeric[3], from))
  const named = text.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/)
  if (!named) return null
  const month = MONTHS.findIndex((name) => name.startsWith(named[1]) && named[1].length >= 3)
  if (month < 0) return null
  return validDay(month + 1, Number(named[2]), yearOf(named[3], from))
}

function yearOf(raw: string | undefined, from: Date): number {
  if (!raw) return from.getFullYear()
  const year = Number(raw)
  return year < 100 ? 2000 + year : year
}

function validDay(month: number, day: number, year: number): string | null {
  const date = new Date(year, month - 1, day)
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return dayKey(date)
}
