import { useMemo, useState } from 'react'
import { useWorkSessions, useWorkTime, type WorkSession, type WorkTimeRow } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { SessionDetail } from './SessionDetail'
import { clockLabel, hm, short, stepped, useSteppedNow } from './time'
import './worksession.css'

// Work Session time where tasks are: Board cards (a chip) and task details (a
// box). Both read the one per-task total from the server (sessions' segments);
// nothing here keeps its own count.

const EMPTY = new Map<string, WorkTimeRow>()

function useWorkTimeMap() {
  const { workspace } = useCurrentWorkspace()
  const q = useWorkTime(workspace?.id)
  return useMemo(() => (q.data ? new Map(q.data.data.map((r) => [r.taskId, r])) : EMPTY), [q.data])
}

/** A row's total as of `now`: exact closed time plus each running stretch in 5-minute steps. */
function total(row: WorkTimeRow, now: number) {
  return row.runningStarts.reduce((sum, at) => sum + stepped(now - Date.parse(at)), row.workedMs)
}

/** Card chip: recorded time, and a live mark while someone is on it. */
export function CardWorkChip({ taskId }: { taskId: string }) {
  const map = useWorkTimeMap()
  const now = useSteppedNow()
  const row = map.get(taskId)
  if (!row) return null
  const ms = total(row, now)
  const working = row.workingNow.map((p) => p.name)
  const label = `${hm(ms)} recorded${working.length ? ` · ${working.join(', ')} working on it now` : ''}`
  return (
    <span className="cal-card-time" data-live={working.length ? '' : undefined} title={label} aria-label={label}>
      {working.length > 0 && <span className="ws-live-dot" aria-hidden="true" />}
      ⏱ {short(ms)}
    </span>
  )
}

const firstName = (name: string) => name.split(/\s+/)[0] ?? name

/** Card line while someone is on the task: who, since when, in the work color. */
export function CardWorking({ taskId }: { taskId: string }) {
  const row = useWorkTimeMap().get(taskId)
  if (!row?.workingNow.length) return null
  const people = row.workingNow
  const since = people.map((p) => p.since).filter(Boolean).sort()[0]
  const names = people.length > 2 ? `${firstName(people[0]!.name)} +${people.length - 1}` : people.map((p) => firstName(p.name)).join(', ')
  const label = `${people.map((p) => p.name).join(', ')} working on it${since ? ` since ${clockLabel(since)}` : ''}`
  return (
    <p className="cal-card-working" title={row.lastUpdate ? `${label} · “${row.lastUpdate.text}”` : label} aria-label={label}>
      <span className="ws-live-dot" aria-hidden="true" />
      <span>{names}</span>
      {since && <span className="ws-num">since {clockLabel(since)}</span>}
    </p>
  )
}

/** Task details: planned vs actual, who worked it, how much, and the latest update. */
export function TaskTimeBox({ taskId, plannedDay }: { taskId: string; plannedDay: string | null }) {
  const { workspace } = useCurrentWorkspace()
  const q = useWorkTime(workspace?.id, taskId)
  const range = useMemo(() => ({ from: new Date(Date.now() - 61 * 86_400_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString(), taskId }), [taskId])
  const sessions = useWorkSessions(workspace?.id, range)
  const now = useSteppedNow()
  const row = q.data?.data[0]

  // The days it was actually worked (local), from the sessions' stretches on this task.
  const days = useMemo(() => {
    const by = new Map<string, number>()
    for (const s of sessions.data ?? []) {
      for (const g of s.segments) {
        if (g.task?.id !== taskId) continue
        const key = new Date(g.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        by.set(key, (by.get(key) ?? 0) + (g.endedAt ? Date.parse(g.endedAt) : Date.now()) - Date.parse(g.startedAt))
      }
    }
    return [...by.entries()]
  }, [sessions.data, taskId])

  const planned = plannedDay ? new Date(`${plannedDay}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null
  return (
    <div className="ticket-meta-box ws-taskbox">
      <h3 className="ticket-meta-box-title">Time</h3>
      {q.isLoading ? <p className="ws-empty">Loading…</p> : !row ? (
        <p className="ws-empty">No time recorded yet. Start a Work Session on this task from the company home.</p>
      ) : (
        <>
          <p className="ws-taskbox-total">{hm(total(row, now))}<span> across {row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}</span></p>
          {row.workingNow.map((p) => (
            <p key={p.memberId} className="ws-taskbox-now"><span className="ws-live-dot" aria-hidden="true" /> {p.name} working on it{p.since ? ` since ${clockLabel(p.since)}` : ' now'}</p>
          ))}
          <ul className="ws-taskbox-people">
            {row.people.map((p) => <li key={p.memberId}><span>{p.name}</span><span>{hm(p.workedMs)}</span></li>)}
          </ul>
          <dl className="ws-taskbox-plan">
            <div><dt>Planned</dt><dd>{planned ?? 'Not scheduled'}</dd></div>
            <div><dt>Worked</dt><dd>{days.length ? days.map(([d, ms]) => `${d} (${short(ms)})`).join(', ') : '—'}</dd></div>
          </dl>
          <TaskSessions sessions={sessions.data ?? []} taskId={taskId} now={now} />
        </>
      )}
    </div>
  )
}

const dayShort = (at: string) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** The task's sessions, newest first: who, when, time on this task, and their updates. Click for the whole session. */
function TaskSessions({ sessions, taskId, now }: { sessions: WorkSession[]; taskId: string; now: number }) {
  const [open, setOpen] = useState<WorkSession | null>(null)
  if (!sessions.length) return null
  const rows = [...sessions].reverse().map((s) => ({
    s,
    ms: s.segments.filter((g) => g.task?.id === taskId).reduce((sum, g) => sum + (g.endedAt ? Date.parse(g.endedAt) : now) - Date.parse(g.startedAt), 0),
  }))
  return (
    <>
      <h4 className="ws-taskbox-sub">Sessions</h4>
      <ol className="ws-taskbox-sessions">
        {rows.map(({ s, ms }) => (
          <li key={s.id}>
            <button type="button" className="ws-taskbox-session" onClick={() => setOpen(s)} aria-label={`${s.member?.name ?? 'Member'}, ${dayShort(s.startedAt)}: open the session`}>
              <span className="ws-taskbox-session-head">
                <strong>{s.member?.name ?? 'Member'}</strong>
                <span>{dayShort(s.startedAt)} · {clockLabel(s.startedAt)}{s.endedAt ? `–${clockLabel(s.endedAt)}` : s.state === 'working' ? ' · now' : ' · paused'}</span>
                <span className="ws-num">{hm(ms)}</span>
              </span>
              {(s.updates ?? []).map((u) => <span key={u.id} className="ws-taskbox-note">“{u.text}” <time dateTime={u.at}>{clockLabel(u.at)}</time></span>)}
            </button>
          </li>
        ))}
      </ol>
      {open && <SessionDetail session={open} onClose={() => setOpen(null)} />}
    </>
  )
}
