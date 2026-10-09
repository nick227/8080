import { useMemo, useRef, useState } from 'react'
import { useAddTaskComment, useTaskActivity, useTaskComments, type Activity, type TaskComment } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { since } from './BoardView'
import { useCalendar } from './store'
import { useTeam } from './sync'
import { STATUSES, type CalTask } from './types'

// A task's activity: comments and history (recorded events) in one timeline.
// History reads the same Activity rows notifications are made from.

type View = 'all' | 'comments' | 'history'

const STATUS = Object.fromEntries(STATUSES.map((s) => [s.id, s.title])) as Record<string, string>
const LABEL: Record<string, string> = { issueType: 'type', area: 'area', priority: 'priority', storyPoints: 'points' }
const VALUE: Record<string, Record<string, string>> = {
  issueType: { task: 'Task', feature: 'Feature', bug: 'Bug', story: 'Story', epic: 'Epic' },
  priority: { low: 'Low', medium: 'Medium', high: 'High', highest: 'Highest' },
}

function day(value: unknown) {
  if (typeof value !== 'string') return ''
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const shown = (field: string, v: unknown) => (v == null || v === '' ? 'none' : VALUE[field]?.[String(v)] ?? String(v))

function changeLine(field: string, [from, to]: [unknown, unknown]): string {
  switch (field) {
    case 'title': return `renamed it to “${to}”`
    case 'description': return 'changed the description'
    case 'scheduledDate': return to ? `scheduled it for ${day(to)}` : 'took it off the calendar'
    case 'scheduledTime': return to ? `set the time to ${to}` : 'cleared the time'
    case 'dueDate': return to ? `set the due date to ${day(to)}` : 'cleared the due date'
    default: return `changed ${LABEL[field] ?? field} from ${shown(field, from)} to ${shown(field, to)}`
  }
}

/** One history line, in words. Exported for tests of wording. */
export function describe(a: Pick<Activity, 'type' | 'summary'>): string {
  const s = a.summary as Record<string, any>
  switch (a.type) {
    case 'task.created': return s.assigneeName ? `created the task and assigned it to ${s.assigneeName}` : 'created the task'
    case 'task.moved': return `moved it from ${STATUS[s.from] ?? s.from} to ${STATUS[s.to] ?? s.to}`
    case 'task.assigned': return s.to ? `assigned it to ${s.toName ?? 'a member'}` : `unassigned ${s.fromName ?? 'it'}`
    case 'task.updated': return Object.entries((s.changes ?? {}) as Record<string, [unknown, unknown]>).map(([f, c]) => changeLine(f, c)).join('; ')
    case 'task.blocked': return s.previous ? `changed what it's waiting on: “${s.reason}”` : `marked it blocked: “${s.reason}”`
    case 'task.unblocked': return `unblocked it${s.blockedForMs ? ` after ${duration(s.blockedForMs)}` : ''}`
    case 'task.deleted': return 'deleted it'
    case 'task.restored': return 'restored it'
    case 'task.commented': return 'commented'
    case 'worklog.created': return `logged work: ${s.summary}${s.hoursSpent != null ? ` (${s.hoursSpent} h)` : ''}${s.completeTask ? ', and closed it' : ''}`
    default: return a.type
  }
}

function duration(ms: number) {
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${Math.max(mins, 1)} min`
  if (mins < 1440) return `${Math.round(mins / 60)} h`
  return `${Math.round(mins / 1440)} d`
}

function when(iso: string) {
  const ago = since(iso)
  return ago === 'just now' ? ago : `${ago} ago`
}

type Line =
  | { kind: 'comment'; at: string; id: string; comment: TaskComment }
  | { kind: 'event'; at: string; id: string; activity: Activity }

export function TaskActivity({ task }: { task: CalTask }) {
  const { workspace } = useCurrentWorkspace()
  const pending = !!task.pending
  const comments = useTaskComments(workspace?.id, pending ? undefined : task.id)
  const history = useTaskActivity(workspace?.id, pending ? undefined : task.id)
  const [view, setView] = useState<View>('all')

  const lines = useMemo(() => {
    const out: Line[] = []
    if (view !== 'history') for (const c of comments.data ?? []) out.push({ kind: 'comment', at: c.createdAt, id: c.id, comment: c })
    if (view !== 'comments') {
      for (const a of history.data ?? []) {
        // Comments show as themselves, not as "commented".
        if (a.type !== 'task.commented') out.push({ kind: 'event', at: a.occurredAt, id: a.id, activity: a })
      }
    }
    // Newest first, like a feed; ties keep the event before its comment.
    return out.sort((x, y) => y.at.localeCompare(x.at))
  }, [comments.data, history.data, view])

  const loading = comments.isLoading || history.isLoading
  return (
    <div className="ticket-section">
      <div className="ticket-activity-head">
        <h3 className="ticket-section-heading">Activity</h3>
        <div className="ticket-activity-tabs" role="group" aria-label="Show">
          {(['all', 'comments', 'history'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'all' ? 'All' : v === 'comments' ? `Comments${comments.data ? ` · ${comments.data.length}` : ''}` : 'History'}
            </button>
          ))}
        </div>
      </div>
      {view !== 'history' && <Composer task={task} />}
      <ol className="ticket-activity-list">
        {loading ? <li className="ticket-no-comments">Loading activity…</li>
          : lines.length === 0 ? <li className="ticket-no-comments">{view === 'comments' ? 'No comments yet.' : 'Nothing yet.'}</li>
          : lines.map((line) => line.kind === 'comment' ? (
            <li key={line.id} className="ticket-comment-bubble">
              <div className="ticket-comment-header">
                <strong className="ticket-comment-author">{line.comment.authorName}</strong>
                <time className="ticket-comment-time" dateTime={line.at}>{when(line.at)}</time>
              </div>
              <p className="ticket-comment-text">{line.comment.text}</p>
            </li>
          ) : (
            <li key={line.id} className="ticket-history-line" data-type={line.activity.type}>
              <span><strong>{line.activity.actor?.name ?? 'Someone'}</strong> {describe(line.activity)}</span>
              <time dateTime={line.at} title={new Date(line.at).toLocaleString()}>{when(line.at)}</time>
            </li>
          ))}
      </ol>
    </div>
  )
}

/** Comment box with @mention suggestions (the server notifies whoever is named). */
function Composer({ task }: { task: CalTask }) {
  const { workspace } = useCurrentWorkspace()
  const { team, meId } = useTeam()
  const addComment = useAddTaskComment(workspace?.id ?? '', task.id)
  const [text, setText] = useState('')
  const [pick, setPick] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const pending = !!task.pending

  const query = text.match(/(?:^|\s)@([^@\n]{0,30})$/)?.[1]
  const suggestions = query === undefined ? [] : team.filter((m) => m.id !== meId && m.name.toLowerCase().startsWith(query.trim().toLowerCase())).slice(0, 5)

  const choose = (name: string) => {
    setText((t) => t.replace(/@([^@\n]{0,30})$/, `@${name} `))
    setPick(0)
    ref.current?.focus()
  }

  const post = () => {
    const clean = text.trim()
    if (!clean || pending) return
    addComment.mutate(clean, { onSuccess: () => setText('') })
  }

  return (
    <form className="ticket-comment-composer" onSubmit={(e) => { e.preventDefault(); post() }}>
      <div className="ticket-composer-field">
        <textarea
          ref={ref}
          rows={2}
          className="ticket-comment-input"
          aria-label="Comment"
          placeholder={pending ? 'Saving the task…' : 'Write a comment… @name to notify someone'}
          value={text}
          disabled={pending}
          onChange={(e) => { setText(e.target.value); setPick(0) }}
          onKeyDown={(e) => {
            if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
            } else if (suggestions.length && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault()
              choose(suggestions[pick]!.name)
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              post()
            }
          }}
        />
        {suggestions.length > 0 && (
          <ul className="cal-menu ticket-mentions" role="listbox" aria-label="Mention">
            {suggestions.map((m, i) => (
              <li key={m.id} role="option" aria-selected={i === pick}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(m.name)}>{m.name}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="submit" className="cal-btn" data-primary="" disabled={!text.trim() || addComment.isPending || pending}>
        {addComment.isPending ? 'Posting…' : 'Comment'}
      </button>
      {addComment.isError && <p className="ticket-no-comments" role="alert">Couldn't post the comment. Try again.</p>}
    </form>
  )
}

/** The blocked flag: banner when set, a short reason form to set or change it. */
export function BlockedControl({ task }: { task: CalTask }) {
  const block = useCalendar((s) => s.block)
  const unblock = useCalendar((s) => s.unblock)
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState(task.blocked?.reason ?? '')
  const open = () => { setReason(task.blocked?.reason ?? ''); setEditing(true) }

  if (editing) {
    return (
      <form className="ticket-blocked" data-editing="" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) { block(task.id, reason); setEditing(false) } }}>
        <label htmlFor={`reason-${task.id}`}>What is it waiting on?</label>
        <input id={`reason-${task.id}`} autoFocus maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }} />
        <button type="submit" className="cal-btn" data-primary="" disabled={!reason.trim()}>{task.blocked ? 'Save' : 'Mark blocked'}</button>
        <button type="button" className="cal-link-btn" onClick={() => setEditing(false)}>Cancel</button>
      </form>
    )
  }
  if (!task.blocked) {
    return <button type="button" className="cal-btn ticket-block-btn" onClick={open} disabled={task.pending}>Mark blocked</button>
  }
  return (
    <div className="ticket-blocked" role="status">
      <strong>Blocked</strong>
      <span className="ticket-blocked-reason">{task.blocked.reason}</span>
      <span className="ticket-blocked-meta">{since(task.blocked.since)}{task.blocked.byName ? ` · ${task.blocked.byName}` : ''}</span>
      <button type="button" className="cal-link-btn" onClick={open}>Edit</button>
      <button type="button" className="cal-btn" onClick={() => unblock(task.id)}>Unblock</button>
    </div>
  )
}
