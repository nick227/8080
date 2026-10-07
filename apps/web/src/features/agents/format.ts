import type { AgentDestination, AgentEventSummary, AgentSchedule } from '@project/sdk'

/** "8:00 AM" from "08:00". */
export function clock(time: string | undefined) {
  if (!time) return ''
  const [h = 0, m = 0] = time.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function scheduleLine(schedule: AgentSchedule | null | undefined) {
  if (!schedule) return ''
  if (schedule.repeat === 'daily') return `${schedule.weekdaysOnly ? 'Weekdays' : 'Daily'} · ${clock(schedule.time)}`
  return clock(schedule.time)
}

export const DESTINATION_LABEL: Record<AgentDestination, string> = { email: 'Email', internal_chat: 'Company chat' }

export function destinationsLine(destinations: AgentDestination[]) {
  return destinations.map((d) => DESTINATION_LABEL[d]).join(' + ')
}

const dayKey = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)

/** "Today · 8:00 AM", "Tomorrow · 8:00 AM", "Mon, Oct 5 · 5:00 PM" in the workspace's zone. */
export function when(iso: string, timeZone: string, now = new Date()) {
  const date = new Date(iso)
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date)
  const day = dayKey(date, timeZone)
  const today = dayKey(now, timeZone)
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000), timeZone)
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000), timeZone)
  const label =
    day === today
      ? 'Today'
      : day === tomorrow
        ? 'Tomorrow'
        : day === yesterday
          ? 'Yesterday'
          : new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(date)
  return `${label} · ${time}`
}

export const STATUS_LABEL: Record<AgentEventSummary['status'], string> = {
  scheduled: 'Scheduled',
  running: 'Sending',
  completed: 'Sent',
  failed: 'Failed',
  canceled: 'Canceled',
}

/** An event that delivered but with some failures still reads as needing attention. */
export const eventTone = (e: Pick<AgentEventSummary, 'status' | 'counts'>) =>
  e.status === 'failed' ? 'failed' : e.status === 'completed' && e.counts.failed > 0 ? 'partial' : e.status
