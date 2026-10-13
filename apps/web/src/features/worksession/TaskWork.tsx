import { useMemo } from 'react'
import { useWorkSessions, useWorkTime, type WorkTimeRow } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
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

/** A row's total as of `now`: closed time plus each running stretch. Steps while running. */
function total(row: WorkTimeRow, now: number) {
  if (!row.runningStarts.length) return row.workedMs
  return stepped(row.runningStarts.reduce((sum, at) => sum + Math.max(0, now - Date.parse(at)), row.workedMs))
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
          {row.workingNow.length > 0 && <p className="ws-taskbox-now"><span className="ws-live-dot" aria-hidden="true" /> {row.workingNow.map((p) => p.name).join(', ')} working on it now</p>}
          <ul className="ws-taskbox-people">
            {row.people.map((p) => <li key={p.memberId}><span>{p.name}</span><span>{hm(p.workedMs)}</span></li>)}
          </ul>
          <dl className="ws-taskbox-plan">
            <div><dt>Planned</dt><dd>{planned ?? 'Not scheduled'}</dd></div>
            <div><dt>Worked</dt><dd>{days.length ? days.map(([d, ms]) => `${d} (${short(ms)})`).join(', ') : '—'}</dd></div>
          </dl>
          {row.lastUpdate && (
            <p className="ws-taskbox-update">“{row.lastUpdate.text}” <span>— {row.lastUpdate.name}, {new Date(row.lastUpdate.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {clockLabel(row.lastUpdate.at)}</span></p>
          )}
        </>
      )}
    </div>
  )
}
