import { dayTitle, parseSpokenDay, cleanTime, monthName, shortDay, todayKey } from '../calendar/dates'
import { listByName } from '../calendar/lists'
import { taskSheets } from '../calendar/sheets'
import { targetDay, useCalendar, wf } from '../calendar/store'
import { useDocuments } from '../documents/store'
import type { Desk } from '../work/sections'

const HELP = 'Add a task, or say open Friday, next month, start the day, follow up, close the day, dump a sheet, or done and a few words of the task.'

export type AgentResult = { reply: string; desk: 'calendar' | null }

export function runAgent(desk: Desk, text: string): AgentResult {
  const trimmed = text.trim()
  if (!trimmed) return { reply: 'Say what to do.', desk: null }
  if (desk !== 'calendar' && !isCalendarCommand(trimmed)) {
    return { reply: 'This tab has no automations yet. On the calendar I can add a task, open a day, push a list, or dump a sheet.', desk: null }
  }
  return runCalendar(trimmed)
}

function isCalendarCommand(text: string): boolean {
  const lower = text.toLowerCase()
  if (/^(help|\?|today|tomorrow|yesterday|status)$/.test(lower)) return true
  if (/^(next|last|previous|prev)\s+month$/.test(lower)) return true
  if (/^what'?s open\b/.test(lower)) return true
  if (/^(open|add|dump|from|sheet|done|close|check)\b/.test(lower)) return true
  if (listByName(lower)) return true
  return parseSpokenDay(lower) !== null
}

function runCalendar(text: string): AgentResult {
  const lower = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const calendar = useCalendar.getState()
  const day = targetDay()

  if (/^(help|\?)$/.test(lower)) return { reply: HELP, desk: null }
  if (/^(next|last|previous|prev)\s+month$/.test(lower)) {
    calendar.shiftMonth(lower.startsWith('next') ? 1 : -1)
    const cursor = useCalendar.getState().cursor
    return { reply: `Showing ${monthName(cursor)} ${cursor.slice(0, 4)}.`, desk: 'calendar' }
  }
  if (lower === 'today' || lower === 'open today') {
    calendar.showDay(todayKey())
    return { reply: `Opened ${dayTitle(todayKey())}.`, desk: 'calendar' }
  }
  if (/^what'?s open\b/.test(lower) || lower === 'status') return { reply: openSummary(day), desk: null }

  const list = listByName(lower)
  if (list) return placed(calendar.addMany(list.tasks, day, list.name), day, list.name)

  const opened = lower.match(/^open\s+(.+)$/)
  if (opened) return openDay(opened[1])
  if (parseSpokenDay(lower) && lower.split(' ').length <= 3) return openDay(lower)

  const done = lower.match(/^(?:done|close|check)\s+(.+)$/)
  if (done) {
    const title = calendar.closeMatching(done[1], day)
    return title
      ? { reply: `Closed "${title}".`, desk: 'calendar' }
      : { reply: `No open task matches "${done[1]}".`, desk: null }
  }

  const dumped = lower.match(/^(?:dump|from|sheet)\s+(.+)$/)
  if (dumped) return dumpSheet(dumped[1], day)

  const added = text.match(/^add\s+(.+)$/i)
  return addTask(added ? added[1] : text, day)
}

function openDay(input: string): AgentResult {
  const day = parseSpokenDay(input)
  if (!day) return { reply: `I can't find "${input.trim()}". Try Friday, tomorrow, or October 6.`, desk: null }
  useCalendar.getState().showDay(day)
  return { reply: `Opened ${dayTitle(day)}.`, desk: 'calendar' }
}

function dumpSheet(name: string, day: string): AgentResult {
  const sheets = taskSheets(useDocuments.getState().docs)
  if (!sheets.length) return { reply: 'No saved sheets to dump.', desk: null }
  const needle = name.trim().toLowerCase()
  const matches = sheets.filter((sheet) => sheet.title.toLowerCase().includes(needle))
  if (!matches.length) return { reply: `No sheet named "${name.trim()}". Saved: ${sheets.map((sheet) => sheet.title).join(', ')}.`, desk: null }
  if (matches.length > 1) return { reply: `Which sheet? ${matches.map((sheet) => sheet.title).join(', ')}.`, desk: null }
  return placed(useCalendar.getState().addMany(matches[0].tasks, day, matches[0].title), day, matches[0].title)
}

function addTask(raw: string, fallback: string): AgentResult {
  let rest = raw.trim()
  let when = fallback
  let time: string | null = null
  const dated = rest.match(/^(.*)\s+on\s+(.+)$/i)
  if (dated) {
    const day = parseSpokenDay(dated[2])
    if (day) {
      rest = dated[1]
      when = day
    }
  }
  const timed = rest.match(/^(.*)\s+at\s+(\d.*)$/i)
  if (timed) {
    const clock = cleanTime(timed[2])
    if (!clock) return { reply: 'Use a time like 14:00 or 2pm.', desk: null }
    rest = timed[1]
    time = clock
  }
  const title = rest.trim()
  if (!title) return { reply: 'Say the task.', desk: null }
  useCalendar.getState().add({ title, day: when, time })
  return { reply: `Added "${title}" to ${dayTitle(when)}${time ? ` at ${time}` : ''}.`, desk: 'calendar' }
}

function placed(count: number, day: string, source: string): AgentResult {
  if (!count) return { reply: `${source} is already on ${shortDay(day)}.`, desk: 'calendar' }
  return { reply: `Placed ${count} from ${source} on ${shortDay(day)}.`, desk: 'calendar' }
}

function openSummary(day: string): string {
  const tasks = useCalendar.getState().tasks.filter((task) => !wf().isDone(task.status))
  const here = tasks.filter((task) => task.day === day)
  const names = here.slice(0, 4).map((task) => task.title).join(', ')
  const more = here.length > 4 ? `, and ${here.length - 4} more` : ''
  const list = names ? ` ${names}${more}.` : ''
  return `${here.length} open on ${shortDay(day)}. ${tasks.length} open on the calendar.${list}`
}
