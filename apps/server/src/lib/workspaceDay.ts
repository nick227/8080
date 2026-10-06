/** Workspace-local calendar day helpers for follow-up views. */

export function localDayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Inclusive start / exclusive end of the local calendar day in `timeZone`, as UTC Dates. */
export function localDayBounds(timeZone: string, at = new Date()) {
  const day = localDayKey(at, timeZone)
  const start = wallTimeToUtc(`${day}T00:00:00`, timeZone)
  const nextNoon = new Date(start.getTime() + 36 * 60 * 60 * 1000)
  const end = wallTimeToUtc(`${localDayKey(nextNoon, timeZone)}T00:00:00`, timeZone)
  return { start, end, day }
}

function offsetMs(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - date.getTime()
}

export function wallTimeToUtc(localIso: string, timeZone: string) {
  const [date = '', time = ''] = localIso.split('T')
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const [hour = 0, minute = 0, second = 0] = time.split(':').map(Number)
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const first = offsetMs(utcGuess, timeZone)
  const adjusted = new Date(utcGuess.getTime() - first)
  const secondPass = offsetMs(adjusted, timeZone)
  return secondPass === first ? adjusted : new Date(utcGuess.getTime() - secondPass)
}
