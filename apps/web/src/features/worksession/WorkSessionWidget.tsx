import { useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  useTaskStatuses,
  useTasks,
  useWorkAction,
  useWorkLobby,
  workSessionApi,
  type WorkLobby,
  type WorkLobbyMember,
  type WorkSessionStop,
} from '@project/sdk'
import { taskPath } from '../tasks/links'
import type { StripSegment } from './DayStrip'
import { useWorkStream } from './live'
import { clockLabel, hm, liveMs, stepped, useSteppedNow } from './time'
import './worksession.css'

// Work Session: the workspace's time clock and team lobby, in two rows — my
// session as one control bar, then who's working on what. Numbers step every
// 5 minutes; the server keeps the exact times.

const POLL_MS = 60_000

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Try again.')

export function WorkSessionWidget({ workspaceId, onInvite }: { workspaceId: string; onInvite?: () => void }) {
  const lobby = useWorkLobby(workspaceId, { refetchInterval: POLL_MS })
  const [listing, setListing] = useState(false)
  useWorkStream(workspaceId)
  const now = useSteppedNow()

  if (lobby.isLoading) return <section className="ws" aria-label="Work Session"><p className="ws-status" role="status">Loading Work Session…</p></section>
  if (lobby.isError || !lobby.data) {
    return (
      <section className="ws" aria-label="Work Session">
        <p className="ws-status" role="alert">Couldn’t load Work Session. <button type="button" className="inline-link" onClick={() => void lobby.refetch()}>Try again</button></p>
      </section>
    )
  }
  const data = lobby.data
  const at = Math.max(now, Date.parse(data.now))
  const working = data.members.filter((m) => m.state === 'working').length
  const paused = data.members.filter((m) => m.state === 'paused').length
  const day = new Date(`${data.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <section className="ws" aria-labelledby="ws-title">
      <header className="ws-head">
        <h2 id="ws-title" className="ws-title">Work Session <span className="ws-date">{day}</span></h2>
        <div className="ws-head-side">
          <p className="ws-count" aria-live="polite">
            <span className="ws-dot" data-state={working ? 'working' : 'off'} aria-hidden="true" />
            {working} working{paused ? ` · ${paused} paused` : ''}
          </p>
          <button type="button" className="ws-link" aria-expanded={listing} onClick={() => setListing((v) => !v)}>{listing ? 'Done' : 'Edit time'}</button>
          {onInvite && <button type="button" className="ws-btn" data-quiet="" onClick={onInvite}>+ Invite</button>}
        </div>
      </header>
      <MySession workspaceId={workspaceId} data={data} now={at} listing={listing} />
      <Team members={data.members} meId={data.me.memberId} now={at} />
    </section>
  )
}

const PlayIcon = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
const PauseIcon = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" /></svg>
const StopIcon = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" /></svg>

// ─── row 1: my session ──────────────────────────────────────────────────────

function MySession({ workspaceId, data, now, listing }: { workspaceId: string; data: WorkLobby; now: number; listing: boolean }) {
  const session = data.me.session
  const me = data.members.find((m) => m.memberId === data.me.memberId)
  const state = session?.state ?? 'off'
  const today = liveMs(me?.todayMs ?? 0, me?.runningSince, now)

  const start = useWorkAction(workspaceId, workSessionApi.start)
  const pause = useWorkAction(workspaceId, workSessionApi.pause)
  const resume = useWorkAction(workspaceId, workSessionApi.resume)
  const switchTask = useWorkAction(workspaceId, workSessionApi.switchTask)
  const [stopping, setStopping] = useState(false)
  const [summary, setSummary] = useState<WorkSessionStop | null>(null)
  const [editing, setEditing] = useState<StripSegment | 'add' | null>(null)
  const [draftTask, setDraftTask] = useState<string>('')
  const closed = data.me.segments.filter((s) => s.endedAt)
  const busy = start.isPending || pause.isPending || resume.isPending || switchTask.isPending
  const error = [start, pause, resume, switchTask].find((m) => m.isError)?.error

  const chosen = session ? (session.task?.id ?? '') : draftTask
  const onTask = (id: string) => {
    if (!session) return setDraftTask(id)
    switchTask.mutate([id || null])
  }
  const shown = hm(state === 'working' ? stepped(today) : today)
  const note = state === 'working' && me?.since ? `Working since ${clockLabel(me.since)}`
    : state === 'paused' && me?.since ? `Paused at ${clockLabel(me.since)}`
    : today > 0 ? 'Recorded today' : 'Not started'

  return (
    <div className="ws-mine" data-state={state}>
      <div className="ws-console">
        <div className="ws-clock" aria-label={`${note}. ${shown} today`}>
          <span className="ws-total">{shown}</span>
          <span className="ws-clock-note"><span className="ws-dot" data-state={state} aria-hidden="true" />{note}</span>
        </div>
        <TaskPicker workspaceId={workspaceId} meId={data.me.memberId} value={chosen} onChange={onTask} disabled={busy} />
        <div className="ws-controls">
          {state === 'off' && (
            <button type="button" className="ws-btn" data-primary="" disabled={busy} onClick={() => { setSummary(null); start.mutate([draftTask || null]) }}>
              <PlayIcon /> Start
            </button>
          )}
          {state === 'working' && <button type="button" className="ws-btn" disabled={busy} onClick={() => pause.mutate([])}><PauseIcon /> Pause</button>}
          {state === 'paused' && <button type="button" className="ws-btn" data-primary="" disabled={busy} onClick={() => resume.mutate([undefined])}><PlayIcon /> Resume</button>}
          {state !== 'off' && <button type="button" className="ws-btn" data-stop="" disabled={busy} aria-expanded={stopping} onClick={() => setStopping((v) => !v)}><StopIcon /> Stop</button>}
        </div>
      </div>

      {state !== 'off' && !stopping && <UpdateForm workspaceId={workspaceId} />}
      {error && <p className="ws-error" role="alert">{message(error)}</p>}
      {stopping && session && (
        <StopPanel workspaceId={workspaceId} data={data} onCancel={() => setStopping(false)} onDone={(s) => { setStopping(false); setSummary(s); setDraftTask('') }} />
      )}
      {summary && <StopSummary summary={summary} onClose={() => setSummary(null)} />}

      {listing && (
        <div className="ws-times">
          {closed.length === 0 && <p className="ws-empty">No time recorded today.</p>}
          <ul className="ws-stretches" aria-label="Today’s recorded time">
            {closed.map((s) => (
              <li key={s.id}>
                <span className="ws-stretch-what">{s.task ? `${s.task.taskKey} · ${s.task.title}` : 'General work'}</span>
                <span className="ws-stretch-when">{clockLabel(s.startedAt)}–{clockLabel(s.endedAt!)} · {hm(s.workedMs ?? 0)}{s.corrected ? ' · corrected' : ''}</span>
                <button type="button" className="ws-link" onClick={() => setEditing(s)}>Edit</button>
              </li>
            ))}
          </ul>
          <button type="button" className="ws-link" onClick={() => setEditing('add')}>Add missed time</button>
        </div>
      )}
      {listing && editing && <TimeEditor key={editing === 'add' ? 'add' : editing.id} workspaceId={workspaceId} segment={editing === 'add' ? null : editing} day={data.day} onClose={() => setEditing(null)} />}
    </div>
  )
}

function TaskPicker({ workspaceId, meId, value, onChange, disabled }: { workspaceId: string; meId: string; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const tasks = useTasks(workspaceId)
  const statuses = useTaskStatuses(workspaceId)
  const groups = useMemo(() => {
    const done = new Set((statuses.data ?? []).filter((s) => s.category === 'done').map((s) => s.key))
    const open = (tasks.data ?? []).filter((t) => !done.has(t.status))
    const mine = open.filter((t) => t.assignee?.memberId === meId)
    const rest = open.filter((t) => !mine.includes(t))
    return { mine, rest }
  }, [tasks.data, statuses.data, meId])
  const known = value && ![...groups.mine, ...groups.rest].some((t) => t.id === value)

  return (
    <select className="ws-task" aria-label="Working on" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">General work (no task)</option>
      {known && <option value={value}>Current task</option>}
      {groups.mine.length > 0 && (
        <optgroup label="Assigned to you">
          {groups.mine.map((t) => <option key={t.id} value={t.id}>{t.taskKey} · {t.title}</option>)}
        </optgroup>
      )}
      {groups.rest.length > 0 && (
        <optgroup label="Other open tasks">
          {groups.rest.map((t) => <option key={t.id} value={t.id}>{t.taskKey} · {t.title}</option>)}
        </optgroup>
      )}
    </select>
  )
}

function StopPanel({ workspaceId, data, onCancel, onDone }: { workspaceId: string; data: WorkLobby; onCancel: () => void; onDone: (s: WorkSessionStop) => void }) {
  const session = data.me.session!
  const stop = useWorkAction(workspaceId, workSessionApi.stop)
  const [note, setNote] = useState('')
  const [complete, setComplete] = useState(false)
  // What this session holds so far, by task (exact minutes; the server has the final word).
  const clock = Date.now()
  const byTask = new Map<string, { label: string; ms: number }>()
  for (const s of session.segments) {
    const key = s.task?.id ?? ''
    const row = byTask.get(key) ?? { label: s.task ? `${s.task.taskKey} · ${s.task.title}` : 'General work', ms: 0 }
    row.ms += (s.endedAt ? Date.parse(s.endedAt) : clock) - Date.parse(s.startedAt)
    byTask.set(key, row)
  }
  const total = [...byTask.values()].reduce((sum, r) => sum + r.ms, 0)
  const updates = data.me.markers.filter((m) => m.type === 'worksession.update' && Date.parse(m.at) >= Date.parse(session.startedAt)).length
  const main = [...byTask.entries()].filter(([id]) => id).sort((a, b) => b[1].ms - a[1].ms)[0]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    stop.mutate([{ accomplishment: note.trim() || null, completeTask: complete && !!note.trim() }], { onSuccess: onDone })
  }

  return (
    <form className="ws-stop" onSubmit={submit} aria-label="Stop session">
      <p className="ws-stop-total"><strong>{hm(total)}</strong> recorded since {clockLabel(session.startedAt)}{updates ? ` · ${updates} ${updates === 1 ? 'update' : 'updates'}` : ''}</p>
    
      <label className="ws-field">
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Closing notes here" />
      </label>
      {main && (
        <label className="ws-check">
          <input type="checkbox" checked={complete} disabled={!note.trim()} onChange={(e) => setComplete(e.target.checked)} />
          <span>Mark {main[1].label.split(' · ')[0]} done</span>
        </label>
      )}
      {stop.isError && <p className="ws-error" role="alert">{message(stop.error)}</p>}
      <div className="ws-controls">
        <button type="submit" className="ws-btn" data-stop="" disabled={stop.isPending}>{stop.isPending ? 'Stopping…' : 'Stop session'}</button>
        <button type="button" className="ws-btn" data-quiet="" onClick={onCancel}>Keep working</button>
      </div>
    </form>
  )
}

function StopSummary({ summary, onClose }: { summary: WorkSessionStop; onClose: () => void }) {
  const tasks = summary.tasks.length
  return (
    <div className="ws-summary" role="status">
      <p>
        <strong>Session saved: {hm(summary.session.workedMs)}</strong>
        {' · '}{tasks} {tasks === 1 ? 'task' : 'tasks'}{summary.updates ? ` · ${summary.updates} ${summary.updates === 1 ? 'update' : 'updates'}` : ''}
        {summary.workLog ? ' · logged as work' : ''}
      </p>
      <button type="button" className="ws-link" onClick={onClose}>Dismiss</button>
    </div>
  )
}

/** Correct a stretch (or add missed time). Both keep a reason; originals stay recorded. */
function TimeEditor({ workspaceId, segment, day, onClose }: { workspaceId: string; segment: StripSegment | null; day: string; onClose: () => void }) {
  const toClock = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  const [from, setFrom] = useState(segment ? toClock(segment.startedAt) : '')
  const [to, setTo] = useState(segment?.endedAt ? toClock(segment.endedAt) : '')
  const [reason, setReason] = useState('')
  const correct = useWorkAction(workspaceId, workSessionApi.correct)
  const add = useWorkAction(workspaceId, workSessionApi.addTime)
  const pending = correct.isPending || add.isPending
  const error = correct.error ?? add.error

  const at = (hhmm: string) => {
    // The segment's own local day (a stretch can start yesterday), else today.
    const base = segment ? new Date(segment.startedAt) : new Date(`${day}T00:00:00`)
    const [h, m] = hhmm.split(':').map(Number)
    base.setHours(h!, m!, 0, 0)
    return base
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const startedAt = at(from)
    const endedAt = at(to)
    if (endedAt <= startedAt) endedAt.setDate(endedAt.getDate() + 1)
    const body = { startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), reason: reason.trim() }
    if (segment) correct.mutate([segment.id, body], { onSuccess: onClose })
    else add.mutate([{ ...body, taskId: null }], { onSuccess: onClose })
  }

  return (
    <form className="ws-edit" onSubmit={submit} aria-label={segment ? 'Correct recorded time' : 'Add missed time'}>
      <p className="ws-edit-title">{segment ? `Correct ${segment.task ? segment.task.taskKey : 'general work'}` : 'Add time you didn’t clock'}</p>
      <div className="ws-edit-row">
        <label className="ws-field"><span>From</span><input type="time" required value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="ws-field"><span>To</span><input type="time" required value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <label className="ws-field"><span>Why</span><input required maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={segment ? 'Forgot to pause for lunch' : 'Forgot to clock in'} /></label>
      <p className="ws-hint">The original times and your reason stay in the history.</p>
      {error && <p className="ws-error" role="alert">{message(error)}</p>}
      <div className="ws-controls">
        <button type="submit" className="ws-btn" data-primary="" disabled={pending || !reason.trim()}>{segment ? 'Save correction' : 'Add time'}</button>
        <button type="button" className="ws-btn" data-quiet="" onClick={onClose}>Cancel</button>
      </div>
    </form>
  )
}


function UpdateForm({ workspaceId }: { workspaceId: string }) {
  const [text, setText] = useState('')
  const post = useWorkAction(workspaceId, workSessionApi.update)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const clean = text.trim()
    if (!clean) return
    post.mutate([{ text: clean }], { onSuccess: () => setText('') })
  }
  return (
    <form className="ws-update" onSubmit={submit}>
      <input aria-label="Add an update" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Add an update — what moved forward?" />
      <button type="submit" className="ws-btn" disabled={post.isPending || !text.trim()}>Post</button>
      {post.isError && <p className="ws-error" role="alert">{message(post.error)}</p>}
    </form>
  )
}

// ─── row 2: the team ────────────────────────────────────────────────────────

function Team({ members, meId, now }: { members: WorkLobbyMember[]; meId: string; now: number }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [showAll, setShowAll] = useState(false)
  // Who's in (working, paused, or clocked some time today) first; the rest fold away.
  const others = members.filter((m) => m.memberId !== meId)
  const inToday = others.filter((m) => m.state !== 'off' || m.todayMs > 0)
  const shown = showAll ? others : inToday
  const hidden = others.length - shown.length

  if (!others.length) return null
  return (
    <div className="ws-team">
      <ul className="ws-people" aria-label="Team">
        {shown.map((m) => {
          const total = liveMs(m.todayMs, m.runningSince, now)
          const what = m.task ? m.task.title : m.state === 'off' ? (total > 0 ? 'Clocked out' : 'Not started') : 'General work'
          return (
            <li key={m.memberId} className="ws-person" data-state={m.state} title={m.lastUpdate ? `Latest update: “${m.lastUpdate.text}” (${clockLabel(m.lastUpdate.at)})` : undefined}>
              {m.avatarUrl ? <img className="ws-avatar" src={m.avatarUrl} alt="" /> : <span className="ws-avatar" aria-hidden="true">{initials(m.name)}</span>}
              <span className="ws-person-main">
                <span className="ws-person-name">{m.name}</span>
                {m.task
                  ? <button type="button" className="ws-person-what ws-task-link" onClick={() => navigate(taskPath(location.pathname, m.task!.taskKey))}>{what}</button>
                  : <span className="ws-person-what">{what}</span>}
              </span>
              <span className="ws-person-time" aria-label={`${m.state === 'working' ? 'Working' : m.state === 'paused' ? 'Paused' : 'Off'}, ${hm(total)} today`}>
                {total > 0 ? hm(m.state === 'working' ? stepped(total) : total) : '—'}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="ws-team-foot">
        {!shown.length && <span>Nobody else is clocked in yet.</span>}
        {(hidden > 0 || showAll) && (
          <button type="button" className="ws-link" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show who’s in' : `Show ${hidden} more`}</button>
        )}
      </p>
    </div>
  )
}
