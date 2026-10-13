import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import type { WorkSession } from '@project/sdk'
import { taskPath } from '../tasks/links'
import { clockLabel, hm, liveMs, useSteppedNow } from './time'
import './worksession.css'

// One work session as a record: who, start → stop, the tasks it touched, each
// stretch, and the updates posted during it. Opened from the Calendar and from a
// task's Time box; reads the session the caller already has (no extra fetch).

const dayLabel = (at: string) => new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/** "11:52 PM – 12:31 AM", or "since 11:52 PM" while open. */
export function sessionSpan(s: WorkSession) {
  if (s.endedAt) return `${clockLabel(s.startedAt)} – ${clockLabel(s.endedAt)}`
  return s.state === 'paused' ? `${clockLabel(s.startedAt)} – paused` : `since ${clockLabel(s.startedAt)}`
}

/** Exact closed time plus the running stretch (stepped by the caller's `now`). */
export const sessionMs = (s: WorkSession, now: number) => liveMs(s.workedMs, s.runningSince, now)

export function SessionDetail({ session, onClose }: { session: WorkSession; onClose: () => void }) {
  const location = useLocation()
  const now = useSteppedNow()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Time per task (general work = no task), longest first.
  const byTask = new Map<string, { task: WorkSession['task']; ms: number }>()
  for (const g of session.segments) {
    const key = g.task?.id ?? ''
    const row = byTask.get(key) ?? { task: g.task, ms: 0 }
    row.ms += (g.endedAt ? Date.parse(g.endedAt) : now) - Date.parse(g.startedAt)
    byTask.set(key, row)
  }
  const tasks = [...byTask.values()].sort((a, b) => b.ms - a.ms)
  const updates = session.updates ?? []
  const name = session.member?.name ?? 'Member'

  return createPortal(
    <div className="ws-modal" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="ws-detail" role="dialog" aria-modal="true" aria-labelledby="ws-detail-title">
        <header className="ws-detail-head">
          <div>
            <h2 id="ws-detail-title">{name} · {dayLabel(session.startedAt)}</h2>
            <p className="ws-detail-span">
              {sessionSpan(session)}
              {session.state !== 'stopped' && <span className="ws-detail-state" data-state={session.state}>{session.state === 'working' ? 'Working now' : 'Paused'}</span>}
            </p>
          </div>
          <p className="ws-detail-total">{hm(sessionMs(session, now))}</p>
          <button ref={closeRef} type="button" className="ws-detail-close" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="ws-detail-body">
          <h3>Worked on</h3>
          <ul className="ws-detail-tasks">
            {tasks.map((t) => (
              <li key={t.task?.id ?? 'general'}>
                {t.task && !t.task.deleted
                  ? <Link to={taskPath(location.pathname, t.task.taskKey)} onClick={onClose}><span className="ws-key">{t.task.taskKey}</span> {t.task.title}</Link>
                  : <span>{t.task ? `${t.task.taskKey} ${t.task.title} (deleted)` : 'General work'}</span>}
                <span className="ws-num">{hm(t.ms)}</span>
              </li>
            ))}
          </ul>

          <h3>Updates</h3>
          {updates.length ? (
            <ol className="ws-detail-updates">
              {updates.map((u) => (
                <li key={u.id}><time dateTime={u.at}>{clockLabel(u.at)}</time><p>{u.text}</p></li>
              ))}
            </ol>
          ) : <p className="ws-empty">No updates posted.</p>}

          <h3>Stretches</h3>
          <ol className="ws-detail-stretches">
            {session.segments.map((g) => (
              <li key={g.id}>
                <span>{clockLabel(g.startedAt)} – {g.endedAt ? clockLabel(g.endedAt) : 'now'}</span>
                <span className="ws-detail-on">{g.task?.taskKey ?? 'General'}</span>
                <span className="ws-num">{g.workedMs != null ? hm(g.workedMs) : ''}</span>
                {g.corrected && <span className="ws-hint" title={`Recorded ${clockLabel(g.corrected.originalStartedAt)}${g.corrected.originalEndedAt ? ` – ${clockLabel(g.corrected.originalEndedAt)}` : ''}`}>edited</span>}
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>,
    document.body,
  )
}
