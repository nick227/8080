import { useEffect, useState } from 'react'

// Work Session time on screen: exact timestamps underneath, quiet numbers on top.
// Running totals move in 5-minute steps (no ticking seconds); finished time is
// shown to the minute.

export const STEP_MS = 5 * 60_000

/** A running total, floored to the 5-minute step. */
export const stepped = (ms: number) => Math.floor(Math.max(0, ms) / STEP_MS) * STEP_MS

/** Closed time plus the running stretch, as of `now`. */
export function liveMs(closedMs: number, runningSince: string | null | undefined, now: number) {
  return closedMs + (runningSince ? Math.max(0, now - Date.parse(runningSince)) : 0)
}

/** "2h 15m", "45m", "0m". */
export function hm(ms: number) {
  const mins = Math.floor(Math.max(0, ms) / 60_000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/** Compact for chips: "2.5h", "45m". */
export function short(ms: number) {
  const mins = Math.floor(Math.max(0, ms) / 60_000)
  if (mins < 60) return `${mins}m`
  const h = mins / 60
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10}h`
}

export const clockLabel = (at: string | number | Date) =>
  new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/**
 * "Now", advanced only at 5-minute boundaries (and when the tab becomes visible
 * again), so durations on screen step instead of tick.
 */
export function useSteppedNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const wait = STEP_MS - (Date.now() % STEP_MS) + 250
      timer = setTimeout(() => { setNow(Date.now()); schedule() }, wait)
    }
    schedule()
    const wake = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    document.addEventListener('visibilitychange', wake)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', wake) }
  }, [])
  return now
}
