import { useEffect, useState } from 'react'
import { useCurrentWorkspace } from '../documents/workspace'
import { useCalendar, useWorkflow } from './store'
import { useTeam } from './sync'
import { BlockedControl, TaskActivity } from './TaskActivity'
import { Checklist, ParentLink, Subtasks } from './TaskStructure'
import { AREAS, type CalTask, type TaskPriority, type TaskStatus, type TaskType } from './types'

const TYPE_LABEL: Record<TaskType, string> = { feature: 'Feature', story: 'Story', bug: 'Bug', task: 'Task', epic: 'Epic' }
const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Low', medium: 'Medium', high: 'High', highest: 'Highest' }

/** One task, full detail. `variant="panel"` sits beside the board instead of replacing it. */
export function TicketPage({
  taskKey,
  onBack,
  variant = 'page',
}: {
  taskKey: string
  onBack: () => void
  variant?: 'page' | 'panel'
}) {
  const task = useCalendar((state) => state.findTaskByNumber(taskKey))
  const loaded = useCalendar((state) => state.loaded)
  const backLabel = variant === 'panel' ? 'Close' : '← Back'

  if (!task) {
    return (
      <div className="ticket-page-missing" data-variant={variant}>
        <header className="ticket-page-nav-bar">
          <button type="button" className="cal-btn" onClick={onBack}>{backLabel}</button>
        </header>
        <div className="ticket-missing-body">
          {loaded ? (
            <>
              <h2>Task not found</h2>
              <p>"{taskKey}" doesn't exist in this workspace, or it was deleted.</p>
            </>
          ) : <p role="status">Loading task…</p>}
        </div>
      </div>
    )
  }
  return <TicketBody key={task.id} task={task} onBack={onBack} variant={variant} backLabel={backLabel} />
}

function TicketBody({ task, onBack, variant, backLabel }: { task: CalTask; onBack: () => void; variant: 'page' | 'panel'; backLabel: string }) {
  const { workspace } = useCurrentWorkspace()
  const { team } = useTeam()
  const workflow = useWorkflow()
  const updateTask = useCalendar((state) => state.updateTask)
  const moveTask = useCalendar((state) => state.updateTaskStatus)
  const remove = useCalendar((state) => state.remove)
  const accomplishments = useCalendar((state) => state.accomplishments)
  const pending = !!task.pending

  // Text fields save on blur; everything else saves on change.
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [copied, setCopied] = useState(false)
  useEffect(() => setTitle(task.title), [task.title])
  useEffect(() => setDescription(task.description ?? ''), [task.description])

  const save = (patch: Partial<CalTask>) => updateTask(task.id, patch)

  const saveTitle = () => {
    const clean = title.trim()
    if (!clean) setTitle(task.title)
    else if (clean !== task.title) save({ title: clean })
  }
  const saveDescription = () => {
    if ((description.trim() || null) !== (task.description ?? null)) save({ description: description.trim() || null })
  }

  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?desk=calendar&ticket=${task.taskKey}`
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const assign = (memberId: string) => {
    const member = team.find((m) => m.id === memberId)
    save({ assigneeId: member?.id ?? null, assigneeName: member?.name ?? null, assigneeAvatar: member?.avatarUrl ?? null })
  }

  const relatedWorkLogs = accomplishments.filter(
    (a) => a.taskId === task.id || a.taskKey?.toUpperCase() === task.taskKey.toUpperCase(),
  )

  return (
    <div className="ticket-page-view" data-variant={variant} role={variant === 'panel' ? 'dialog' : 'main'} aria-label={`Task ${task.taskKey}`}>
      <header className="ticket-page-nav-bar">
        <div className="ticket-nav-left">
          <button type="button" className="cal-btn" onClick={onBack}>{backLabel}</button>
          <span className="ticket-page-key-badge">{task.taskKey}</span>
          <button type="button" className="cal-btn ticket-copy-btn" onClick={copyLink} disabled={pending}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        </div>
        <div className="ticket-nav-right">
          <label className="ticket-status-label" htmlFor={`status-${task.id}`}>Status</label>
          <select id={`status-${task.id}`} className="cal-status-select" data-status={task.status} value={task.status} onChange={(e) => moveTask(task.id, e.target.value as TaskStatus)}>
            {workflow.active.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button type="button" className="cal-btn ticket-delete-btn" onClick={() => { remove(task.id); onBack() }}>
            Delete
          </button>
        </div>
      </header>

      <div className="ticket-page-container">
        <div className="ticket-main-col">
          <div className="ticket-title-wrap">
            <input
              className="ticket-title-input"
              aria-label="Title"
              value={title}
              placeholder="Task summary…"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            />
          </div>

          <ParentLink task={task} />
          <BlockedControl key={task.blocked?.reason ?? 'clear'} task={task} />

          <div className="ticket-section">
            <h3 className="ticket-section-heading">Description</h3>
            <textarea
              className="ticket-description-textarea"
              aria-label="Description"
              rows={6}
              placeholder="Details, acceptance criteria, steps to reproduce…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
            />
          </div>

          {relatedWorkLogs.length > 0 && (
            <div className="ticket-section">
              <h3 className="ticket-section-heading">Work logged ({relatedWorkLogs.length})</h3>
              <div className="ticket-work-logs-list">
                {relatedWorkLogs.map((log) => (
                  <div key={log.id} className="ticket-work-log-card">
                    <span className="ticket-log-icon">{log.icon || '✅'}</span>
                    <div className="ticket-log-info">
                      <strong>{log.title}</strong>
                      <span className="ticket-log-meta">
                        {log.assigneeName ? `${log.assigneeName} · ` : ''}
                        {log.day} {log.time ? `at ${log.time}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Checklist task={task} />
          <Subtasks task={task} />
          <TaskActivity task={task} />
        </div>

        <aside className="ticket-sidebar-col">
          <div className="ticket-meta-box">
            <h3 className="ticket-meta-box-title">Details</h3>
            <Field label="Assignee">
              <select value={task.assigneeId ?? ''} onChange={(e) => assign(e.target.value)}>
                <option value="">Unassigned</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                {task.assigneeId && !team.some((m) => m.id === task.assigneeId) && <option value={task.assigneeId}>{task.assigneeName ?? 'Former member'}</option>}
              </select>
            </Field>
            <Field label="Type">
              <select value={task.category ?? 'task'} onChange={(e) => save({ category: e.target.value as TaskType })}>
                {(Object.keys(TYPE_LABEL) as TaskType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Area">
              <select value={task.area ?? ''} onChange={(e) => save({ area: e.target.value || null })}>
                <option value="">None</option>
                {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                {task.area && !(AREAS as readonly string[]).includes(task.area) && <option value={task.area}>{task.area}</option>}
              </select>
            </Field>
            <Field label="Priority">
              <select value={task.priority ?? 'medium'} onChange={(e) => save({ priority: e.target.value as TaskPriority })}>
                {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </Field>
            <Field label="Story points">
              <select value={task.storyPoints ?? ''} onChange={(e) => save({ storyPoints: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">None</option>
                {[1, 2, 3, 5, 8, 13].map((n) => <option key={n} value={n}>{n}</option>)}
                {task.storyPoints != null && ![1, 2, 3, 5, 8, 13].includes(task.storyPoints) && <option value={task.storyPoints}>{task.storyPoints}</option>}
              </select>
            </Field>
            <Field label="Due date">
              <input type="date" value={task.dueDate ?? ''} onChange={(e) => save({ dueDate: e.target.value || null })} />
            </Field>
            <Field label="Calendar day">
              <input type="date" value={task.day ?? ''} onChange={(e) => save({ day: e.target.value || null })} />
            </Field>
            <Field label="Time">
              <input type="time" value={task.time ?? ''} disabled={!task.day} title={task.day ? undefined : 'Pick a calendar day first'} onChange={(e) => save({ time: e.target.value || null })} />
            </Field>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="ticket-meta-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function when(iso: string) {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
