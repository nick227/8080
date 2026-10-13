import type { WorkMarker, WorkSegment } from '@project/sdk'
import { STEP_MS, clockLabel, hm } from './time'

// A day drawn in 5-minute cells: worked (solid), paused (hatched: inside a
// session, between its stretches) and unrecorded (empty), with the start/stop,
// task-switch and update markers on top. Exact bounds are in each block's label;
// only the drawing snaps to the grid.

const HOUR = 3_600_000

export type StripSegment = Pick<WorkSegment, 'id' | 'sessionId' | 'startedAt' | 'endedAt' | 'task'> & { corrected?: unknown }

type Props = {
  segments: StripSegment[]
  markers?: WorkMarker[]
  /** The session still open (its trailing pause runs to now). */
  openSession?: { id: string; state: string } | null
  dayStart: number
  dayEnd: number
  now: number
  label: string
  onSegment?: (segment: StripSegment) => void
}

const snap = (t: number) => Math.round(t / STEP_MS) * STEP_MS

/** The visible window: working hours, stretched to cover anything recorded. */
export function stripWindow(segments: StripSegment[], dayStart: number, dayEnd: number, now: number) {
  let from = dayStart + 8 * HOUR
  let to = dayStart + 18 * HOUR
  for (const s of segments) {
    from = Math.min(from, Date.parse(s.startedAt))
    to = Math.max(to, s.endedAt ? Date.parse(s.endedAt) : now)
  }
  if (now >= dayStart && now < dayEnd) to = Math.max(to, now)
  from = Math.max(dayStart, Math.floor(from / HOUR) * HOUR)
  to = Math.min(dayEnd, Math.ceil(to / HOUR) * HOUR)
  return { from, to }
}

const MARK: Record<string, string | undefined> = {
  'worksession.started': 'Start',
  'worksession.stopped': 'Stop',
  'worksession.paused': 'Pause',
  'worksession.resumed': 'Resume',
  'worksession.switched': 'Switched task',
  'worksession.update': 'Update',
  'worksession.added': 'Time added',
  'worksession.corrected': 'Corrected',
}

export function markerText(m: WorkMarker) {
  const s = m.summary as { text?: string; taskKey?: string; title?: string; reason?: string }
  const what = MARK[m.type] ?? m.type
  if (m.type === 'worksession.update') return `${what}: ${s.text ?? ''}`
  if (m.type === 'worksession.corrected' || m.type === 'worksession.added') return `${what}: ${s.reason ?? ''}`
  return s.taskKey ? `${what} · ${s.taskKey} ${s.title ?? ''}` : what
}

export function DayStrip({ segments, markers = [], openSession, dayStart, dayEnd, now, label, onSegment }: Props) {
  const { from, to } = stripWindow(segments, dayStart, dayEnd, now)
  const span = to - from
  const pct = (t: number) => `${((Math.min(Math.max(t, from), to) - from) / span) * 100}%`
  const width = (a: number, b: number) => `${(Math.max(STEP_MS, Math.min(b, to) - Math.max(a, from)) / span) * 100}%`

  // Pauses: gaps between stretches of the same session, and an open session's trailing pause.
  const pauses: { a: number; b: number }[] = []
  const bySession = new Map<string, StripSegment[]>()
  for (const s of segments) bySession.set(s.sessionId, [...(bySession.get(s.sessionId) ?? []), s])
  for (const [id, list] of bySession) {
    for (let i = 1; i < list.length; i++) {
      const a = Date.parse(list[i - 1]!.endedAt ?? '')
      const b = Date.parse(list[i]!.startedAt)
      if (b - a >= 60_000) pauses.push({ a, b })
    }
    const last = list.at(-1)!
    if (openSession?.id === id && openSession.state === 'paused' && last.endedAt) pauses.push({ a: Date.parse(last.endedAt), b: now })
  }

  // Hour labels thin out on long days so they never collide.
  const every = span > 10 * HOUR ? 3 : span > 6 * HOUR ? 2 : 1
  const hours: number[] = []
  for (let t = from; t <= to; t += HOUR * every) hours.push(t)
  const shownMarkers = markers.filter((m) => MARK[m.type] && m.type !== 'worksession.paused' && m.type !== 'worksession.resumed')
  const inDay = now >= from && now <= to

  return (
    <figure className="ws-strip" aria-label={label}>
      <div className="ws-strip-track" style={{ ['--ws-cells' as string]: String(span / STEP_MS) }}>
        {pauses.map((p, i) => (
          <span key={`p${i}`} className="ws-strip-pause" style={{ left: pct(snap(p.a)), width: width(snap(p.a), snap(p.b)) }} title={`Paused ${clockLabel(p.a)}–${clockLabel(p.b)} (${hm(p.b - p.a)})`} />
        ))}
        {segments.map((s) => {
          const a = Date.parse(s.startedAt)
          const b = s.endedAt ? Date.parse(s.endedAt) : now
          const text = `${s.task ? `${s.task.taskKey} ${s.task.title}` : 'General work'} · ${clockLabel(a)}–${s.endedAt ? clockLabel(b) : 'now'} (${hm(b - a)})${s.corrected ? ' · corrected' : ''}`
          const style = { left: pct(snap(a)), width: width(snap(a), snap(b)) }
          return onSegment && s.endedAt
            ? <button key={s.id} type="button" className="ws-strip-work" data-running={!s.endedAt || undefined} data-corrected={s.corrected ? '' : undefined} style={style} title={`${text}. Edit`} aria-label={`${text}. Edit`} onClick={() => onSegment(s)} />
            : <span key={s.id} className="ws-strip-work" data-running={!s.endedAt || undefined} data-corrected={s.corrected ? '' : undefined} style={style} title={text} />
        })}
        {shownMarkers.map((m) => (
          <span key={m.id} className="ws-strip-mark" data-kind={m.type.slice('worksession.'.length)} style={{ left: pct(Date.parse(m.at)) }} title={`${clockLabel(m.at)} · ${markerText(m)}`} />
        ))}
        {inDay && <span className="ws-strip-now" style={{ left: pct(now) }} aria-hidden="true" />}
      </div>
      <div className="ws-strip-hours" aria-hidden="true">
        {hours.map((t, i) => (
          <span key={t} style={{ left: pct(t) }} data-edge={i === 0 ? 'start' : i === hours.length - 1 ? 'end' : undefined}>
            {new Date(t).toLocaleTimeString(undefined, { hour: 'numeric' })}
          </span>
        ))}
      </div>
    </figure>
  )
}
