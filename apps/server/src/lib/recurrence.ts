// Exact workspace-local schedules for Agents (docs/agents/04 "Scheduling"): no quiet
// hours, no business-hours shifting. A rule plus the workspace timezone gives the
// next occurrence after an instant, and a stable key naming that occurrence.
import { localDayKey, wallTimeToUtc } from './workspaceDay'

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6 // Sunday = 0
export type Nth = 1 | 2 | 3 | 4 | 'last'

export type Recurrence =
  | { repeat: 'once'; at: string } // local "YYYY-MM-DDTHH:MM"
  | { repeat: 'daily'; time: string; weekdaysOnly?: boolean }
  | { repeat: 'weekly'; weekday: Weekday; time: string }
  | { repeat: 'monthly'; nth: Nth; weekday: Weekday; time: string } // e.g. first Monday
  | { repeat: 'monthly'; date: number | 'last'; time: string } // 1–28 or last day

export type Occurrence = { at: Date; key: string }

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/
const isWeekday = (v: unknown): v is Weekday => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6

/** Problems with `value` as a Recurrence (empty = valid). */
export function recurrenceProblems(value: unknown): string[] {
  const r = value as Recurrence
  if (!r || typeof r !== 'object') return ['schedule is required']
  switch (r.repeat) {
    case 'once':
      return LOCAL.test(r.at ?? '') ? [] : ['choose a date and time']
    case 'daily':
      return TIME.test(r.time ?? '') ? [] : ['choose a time']
    case 'weekly':
      return [...(isWeekday(r.weekday) ? [] : ['choose a day']), ...(TIME.test(r.time ?? '') ? [] : ['choose a time'])]
    case 'monthly': {
      const day =
        'nth' in r
          ? [1, 2, 3, 4, 'last'].includes(r.nth) && isWeekday(r.weekday)
          : 'date' in r && (r.date === 'last' || (Number.isInteger(r.date) && r.date >= 1 && r.date <= 28))
      return [...(day ? [] : ['choose a day']), ...(TIME.test(r.time ?? '') ? [] : ['choose a time'])]
    }
    default:
      return ['choose how often it repeats']
  }
}

/** The first occurrence strictly after `after`, or null (a past one-time schedule). */
export function nextOccurrence(rule: Recurrence, after: Date, timeZone: string): Occurrence | null {
  if (rule.repeat === 'once') {
    const at = wallTimeToUtc(`${rule.at}:00`, timeZone)
    return at > after ? { at, key: rule.at } : null
  }
  // Walk local calendar days from the day before `after` (covers zones behind UTC).
  let day = shiftDay(localDayKey(after, timeZone), -1)
  for (let i = 0; i < 800; i++, day = shiftDay(day, 1)) {
    if (!matches(rule, day)) continue
    const key = `${day}T${rule.time}`
    const at = wallTimeToUtc(`${key}:00`, timeZone)
    if (at > after) return { at, key }
  }
  return null
}

const ymd = (day: string): [number, number, number] => {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
  return [y, m, d]
}

function matches(rule: Exclude<Recurrence, { repeat: 'once' }>, day: string): boolean {
  const [y, m, d] = ymd(day)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const monthLength = new Date(Date.UTC(y, m, 0)).getUTCDate()
  switch (rule.repeat) {
    case 'daily':
      return !rule.weekdaysOnly || (weekday >= 1 && weekday <= 5)
    case 'weekly':
      return weekday === rule.weekday
    case 'monthly':
      if ('date' in rule) return rule.date === 'last' ? d === monthLength : d === rule.date
      if (weekday !== rule.weekday) return false
      return rule.nth === 'last' ? d + 7 > monthLength : Math.ceil(d / 7) === rule.nth
  }
}

function shiftDay(day: string, delta: number) {
  const [y, m, d] = ymd(day)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}
