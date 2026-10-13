import { useMemo, useState } from 'react'
import { useWorkSessions, type WorkSession } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { DayStrip } from './DayStrip'
import { SessionDetail, sessionSpan } from './SessionDetail'
import { hm, short, useSteppedNow } from './time'
import './worksession.css'

// The Calendar's actual time: Work Sessions drawn beside the planned tasks (in
// the work color), never replacing them. Days are the viewer's local days.

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

export type DayWork = { ms: number; sessions: { session: WorkSession; ms: number }[] }

/** Worked time and sessions per local day (everyone), for the month grid. */
export function useWorkedByDay(firstDay: string, lastDay: string) {
  const { workspace } = useCurrentWorkspace()
  const range = useMemo(() => ({ from: new Date(dayStart(firstDay)).toISOString(), to: new Date(nextDay(lastDay)).toISOString() }), [firstDay, lastDay])
  const q = useWorkSessions(workspace?.id, range)
  const now = useSteppedNow()
  return useMemo(() => {
    const by = new Map<string, DayWork>()
    for (const s of q.data ?? []) {
      const perDay = new Map<string, number>()
      for (const g of s.segments) {
        // Split a stretch across midnights so each day gets its own part.
        let a = Date.parse(g.startedAt)
        const b = g.endedAt ? Date.parse(g.endedAt) : now
        while (a < b) {
          const key = localKey(a)
          const end = Math.min(b, nextDay(key))
          perDay.set(key, (perDay.get(key) ?? 0) + end - a)
          a = end
        }
      }
      for (const [key, ms] of perDay) {
        const day = by.get(key) ?? { ms: 0, sessions: [] }
        day.ms += ms
        day.sessions.push({ session: s, ms })
        by.set(key, day)
      }
    }
    return by
  }, [q.data, now])
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

/** The task a session is about: the one it spent longest on, else general work. */
function mainTask(s: WorkSession) {
  const by = new Map<string, { key: string; ms: number }>()
  for (const g of s.segments) {
    if (!g.task) continue
    const row = by.get(g.task.id) ?? { key: g.task.taskKey, ms: 0 }
    row.ms += (g.endedAt ? Date.parse(g.endedAt) : Date.now()) - Date.parse(g.startedAt)
    by.set(g.task.id, row)
  }
  return [...by.values()].sort((a, b) => b.ms - a.ms)[0]?.key ?? null
}

const MONTH_SHOWN = 2

/** Month cell: one work chip per session (person, time, task), in the work color. */
export function MonthWork({ day }: { day: DayWork | undefined }) {
  const [open, setOpen] = useState<WorkSession | null>(null)
  if (!day?.sessions.length) return null
  const shown = day.sessions.slice(0, MONTH_SHOWN)
  const more = day.sessions.length - shown.length
  return (
    <span className="ws-month">
      {shown.map(({ session: s, ms }) => {
        const who = s.member?.name ?? 'Member'
        const key = mainTask(s)
        return (
          <button
            key={s.id}
            type="button"
            className="ws-chip"
            data-live={s.state === 'working' ? '' : undefined}
            title={`${who} worked ${hm(ms)}${key ? ` on ${key}` : ''} (${sessionSpan(s)})`}
            onClick={(e) => { e.stopPropagation(); setOpen(s) }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <span className="ws-chip-who">{initials(who)}</span>
            <span className="ws-num">{short(ms)}</span>
            {key && <span className="ws-chip-task">{key}</span>}
          </button>
        )
      })}
      {more > 0 && <span className="cal-more">+{more} sessions</span>}
      {open && <SessionDetail session={open} onClose={() => setOpen(null)} />}
    </span>
  )
}

/** Today's sessions for the day view, keyed by the hour slot each starts in ("09:00"). */
export function useDayWork(day: string) {
  const { workspace } = useCurrentWorkspace()
  const from = dayStart(day)
  const to = nextDay(day)
  const range = useMemo(() => ({ from: new Date(from).toISOString(), to: new Date(to).toISOString() }), [from, to])
  const q = useWorkSessions(workspace?.id, range)
  return useMemo(() => {
    const byHour = new Map<string, WorkSession[]>()
    for (const s of q.data ?? []) {
      // A session from the night before shows at midnight.
      const at = new Date(Math.max(from, Date.parse(s.startedAt)))
      const key = `${String(at.getHours()).padStart(2, '0')}:00`
      byHour.set(key, [...(byHour.get(key) ?? []), s])
    }
    return byHour
  }, [q.data, from])
}

/** Day view: a session as a block in its starting hour: who, when, how long, on what, the latest update. */
export function WorkBlock({ session: s }: { session: WorkSession }) {
  const [open, setOpen] = useState(false)
  const now = useSteppedNow()
  const who = s.member?.name ?? 'Member'
  const key = mainTask(s)
  const task = s.segments.find((g) => g.task?.taskKey === key)?.task ?? null
  const last = s.updates?.at(-1)
  const ms = s.workedMs + (s.runningSince ? Math.max(0, now - Date.parse(s.runningSince)) : 0)
  return (
    <>
      <button type="button" className="ws-block" data-state={s.state} onClick={() => setOpen(true)} aria-label={`${who}'s work session, ${sessionSpan(s)}, ${hm(ms)}. Open details`}>
        <span className="ws-block-line">
          <strong>{who}</strong>
          <span>{sessionSpan(s)}</span>
          <span className="ws-num">{hm(ms)}</span>
        </span>
        <span className="ws-block-on">{task ? <><span className="ws-key">{task.taskKey}</span> {task.title}</> : 'General work'}</span>
        {last && <span className="ws-block-update">“{last.text}”{(s.updates?.length ?? 0) > 1 ? ` · ${s.updates!.length} updates` : ''}</span>}
      </button>
      {open && <SessionDetail session={s} onClose={() => setOpen(false)} />}
    </>
  )
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
