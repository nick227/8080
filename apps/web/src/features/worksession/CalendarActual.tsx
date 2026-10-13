import { useMemo } from 'react'
import { useWorkSessions, type WorkSession } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { DayStrip } from './DayStrip'
import { hm, short, useSteppedNow } from './time'
import './worksession.css'

// The Calendar's actual time: Work Session stretches drawn beside the planned
// tasks, never replacing them. Days are the viewer's local days.

const dayStart = (day: string) => new Date(`${day}T00:00:00`).getTime()
const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return d.getTime()
}
const localKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Member = NonNullable<WorkSession['member']>

/** Worked time per local day (everyone), for the month grid. */
export function useWorkedByDay(firstDay: string, lastDay: string) {
  const { workspace } = useCurrentWorkspace()
  const range = useMemo(() => ({ from: new Date(dayStart(firstDay)).toISOString(), to: new Date(nextDay(lastDay)).toISOString() }), [firstDay, lastDay])
  const q = useWorkSessions(workspace?.id, range)
  const now = useSteppedNow()
  return useMemo(() => {
    const by = new Map<string, number>()
    for (const s of q.data ?? []) {
      for (const g of s.segments) {
        // Split a stretch across midnights so each day gets its own part.
        let a = Date.parse(g.startedAt)
        const b = g.endedAt ? Date.parse(g.endedAt) : now
        while (a < b) {
          const key = localKey(a)
          const end = Math.min(b, nextDay(key))
          by.set(key, (by.get(key) ?? 0) + end - a)
          a = end
        }
      }
    }
    return by
  }, [q.data, now])
}

export function WorkedBadge({ ms }: { ms: number | undefined }) {
  if (!ms) return null
  return <span className="cal-day-worked" title={`${hm(ms)} recorded by the team`}>⏱ {short(ms)}</span>
}

/** One strip per person who worked that day, with their total. */
export function DayActual({ day }: { day: string }) {
  const { workspace } = useCurrentWorkspace()
  const from = dayStart(day)
  const to = nextDay(day)
  const range = useMemo(() => ({ from: new Date(from).toISOString(), to: new Date(to).toISOString() }), [from, to])
  const q = useWorkSessions(workspace?.id, range)
  const now = useSteppedNow()

  const people = useMemo(() => {
    const by = new Map<string, { member: Member; sessions: WorkSession[]; ms: number }>()
    for (const s of q.data ?? []) {
      if (!s.member) continue
      const row = by.get(s.memberId) ?? { member: s.member, sessions: [], ms: 0 }
      row.sessions.push(s)
      for (const g of s.segments) {
        const a = Math.max(from, Date.parse(g.startedAt))
        const b = Math.min(to, g.endedAt ? Date.parse(g.endedAt) : now)
        row.ms += Math.max(0, b - a)
      }
      by.set(s.memberId, row)
    }
    return [...by.values()].sort((a, b) => b.ms - a.ms)
  }, [q.data, from, to, now])

  if (!people.length) return null
  return (
    <section className="cal-actual" aria-label="Actual time worked">
      <h4>Worked</h4>
      {people.map((p) => (
        <div key={p.member.memberId} className="cal-actual-row">
          <p className="cal-actual-who"><span>{p.member.name}</span><span>{hm(p.ms)}</span></p>
          <DayStrip
            segments={p.sessions.flatMap((s) => s.segments)}
            openSession={p.sessions.find((s) => s.state !== 'stopped') ?? null}
            dayStart={from}
            dayEnd={to}
            now={now}
            label={`${p.member.name}: worked and paused time on ${day}`}
          />
        </div>
      ))}
    </section>
  )
}
