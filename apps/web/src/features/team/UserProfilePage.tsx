import { TaskLink } from '../tasks/TaskLink'
import { useMemo, useState } from 'react'
import { useMemberWork, type WorkSession } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { SessionDetail, sessionSpan } from '../worksession/SessionDetail'
import { hm, liveMs, stepped, useSteppedNow } from '../worksession/time'
import { useCalendar, useWorkflow } from '../calendar/store'
import { WORK_CATEGORIES, type CalAccomplishment, type CalTask, type WorkCategory } from '../calendar/types'
import { todayKey } from '../calendar/dates'
import { PersonIcon } from '../../components/icons'
import type { Seat } from '../room/roomViews'
import './team.css'

export type ExtendedMember = {
  id: string
  /** The account behind a membership (seats are keyed by user id). */
  userId?: string
  name: string
  tag?: string
  avatarUrl?: string
  role?: string
  department?: string
  email?: string
  presence?: 'online' | 'in_meeting' | 'focus' | 'offline'
  activity?: 'typing' | 'recording' | 'here' | 'away'
  self?: boolean
  guest?: boolean
  bio?: string
  skills?: string[]
}

export function UserProfilePage({
  member,
  seat,
  inRoom = true,
  onBack,
  onAssignTask,
}: {
  member: ExtendedMember
  seat?: Seat
  /** False on company pages: no room, so no presence. */
  inRoom?: boolean
  onBack: () => void
  onAssignTask: (userId: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'log' | 'tasks' | 'info'>('log')
  const [showLogModal, setShowLogModal] = useState(false)

  const tasks = useCalendar((s) => s.tasks)
  const accomplishments = useCalendar((s) => s.accomplishments)
  const updateTaskStatus = useCalendar((s) => s.updateTaskStatus)
  const addAccomplishment = useCalendar((s) => s.addAccomplishment)
  const workflow = useWorkflow()

  // Find all tasks assigned to this user (matching id or name)
  const userTasks = useMemo(() => {
    return tasks.filter(
      (t) =>
        t.assigneeId === member.id ||
        (t.assigneeName && t.assigneeName.toLowerCase() === member.name.toLowerCase())
    )
  }, [tasks, member.id, member.name])

  // Find all accomplishments logged by or for this user
  const userLogs = useMemo(() => {
    return accomplishments.filter(
      (acc) =>
        acc.assigneeId === member.id ||
        (acc.assigneeName && acc.assigneeName.toLowerCase() === member.name.toLowerCase()) ||
        acc.authorMemberId === member.id
    )
  }, [accomplishments, member.id, member.name])

  // Work Session time (recorded by the clock) — vacant seats have no membership.
  const { workspace } = useCurrentWorkspace()
  const work = useMemberWork(workspace?.id, member.id.startsWith('vacant:') ? undefined : member.id).data
  const now = useSteppedNow()
  const [openSession, setOpenSession] = useState<WorkSession | null>(null)
  const sessionMs = work ? work.workedMs + (work.runningSince ? stepped(now - Date.parse(work.runningSince)) : 0) : 0

  // KPI Calculations
  const completedTasksCount = userTasks.filter((t) => workflow.isDone(t.status)).length
  const inProgressTasksCount = userTasks.filter((t) => !workflow.isDone(t.status)).length
  // Hours = session time + Log work credited to them; an entry written by Stop is that session's time, so it counts once.
  const creditedLogs = userLogs.filter((l) => l.assigneeId === member.id || (!l.assigneeId && l.authorMemberId === member.id))
  const loggedOnlyHours = creditedLogs.filter((l) => !l.sessionId).reduce((acc, curr) => acc + (curr.hoursSpent || 0), 0)
  const totalHoursLogged = Math.round((sessionMs / 3_600_000 + loggedOnlyHours) * 100) / 100
  const recent = work?.recent ?? []
  const workingOn = recent.find((s) => s.state === 'working')
  // A Stop-written entry belongs to its session: shown inside it, not as its own row.
  const doneBySession = useMemo(() => new Map(userLogs.filter((l) => l.sessionId).map((l) => [l.sessionId!, l])), [userLogs])
  const timeline = useMemo(() => {
    const listed = new Set(recent.map((s) => s.id))
    const rows: ({ kind: 'session'; at: string; session: WorkSession } | { kind: 'log'; at: string; log: CalAccomplishment })[] = [
      ...recent.map((session) => ({ kind: 'session' as const, at: session.startedAt, session })),
      ...userLogs.filter((log) => !log.sessionId || !listed.has(log.sessionId)).map((log) => ({ kind: 'log' as const, at: `${log.day}T${log.time ?? '00:00'}`, log })),
    ]
    // Newest first; sessions carry exact instants, logs a local day + time.
    return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [recent, userLogs])

  // Quick form state for logging work
  const [logTitle, setLogTitle] = useState('')
  const [logCategory, setLogCategory] = useState<WorkCategory>('work')
  const [logHours, setLogHours] = useState<number>(1)

  const handleCreateLog = (e: React.FormEvent) => {
    e.preventDefault()
    if (!logTitle.trim()) return

    addAccomplishment({
      title: logTitle.trim(),
      category: logCategory,
      hoursSpent: Number(logHours) || 1,
      assigneeId: member.id,
      assigneeName: member.name,
      day: todayKey(),
    })

    setLogTitle('')
    setShowLogModal(false)
    useCalendar.getState().say(`Logged work for ${member.name}: "${logTitle.trim()}"`)
  }

  const presenceStatus = seat?.activity ?? member.presence ?? 'online'
  const isOnline = presenceStatus !== 'offline'

  return (
    <div className="user-profile-page">
      {/* Navigation Header */}
      <div className="user-page-nav">
        <button type="button" className="user-back-btn" onClick={onBack}>
          ← Back to team
        </button>
        <div className="user-page-actions">
          <button type="button" className="team-btn-secondary" onClick={() => setShowLogModal(true)}>
            + Log work
          </button>
          <button type="button" className="team-btn-primary" onClick={() => onAssignTask(member.id)}>
            + Assign task
          </button>
        </div>
      </div>

      {/* Hero Header Card */}
      <div className="user-hero-card">
        <div className="user-avatar-wrap">
          {member.avatarUrl ? (
            <img src={member.avatarUrl} alt={member.name} className="user-hero-avatar" />
          ) : (
            <div className="user-hero-avatar-placeholder">
              <PersonIcon guest={Boolean(member.guest)} />
            </div>
          )}
          {inRoom && <span className={`user-presence-dot ${isOnline ? 'online' : 'offline'}`} title={isOnline ? 'In this room' : 'Not in this room'} />}
        </div>

        <div className="user-hero-details">
          <div className="user-hero-title-row">
            <h1>{member.name}</h1>
            {member.tag && <span className="user-tag">{member.tag}</span>}
            {member.self && <span className="user-badge self">You</span>}
            {member.guest && <span className="user-badge guest">Guest</span>}
          </div>
          <p className="user-hero-role">
            {member.role || 'Member'}{member.department && <> &bull; <span className="user-dept">{member.department}</span></>}
          </p>
          <div className="user-hero-meta">
            {inRoom && (
              <span className="user-meta-item">
                <strong>{isOnline ? 'In this room' : 'Not in this room'}</strong>
              </span>
            )}
            {member.email && (
              <span className="user-meta-item">
                <span className="meta-icon">✉️</span> {member.email}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* KPI Stats Row */}
      <div className="user-kpi-row">
        <div className="user-kpi-card">
          <span className="kpi-label">Active tasks</span>
          <span className="kpi-value">{inProgressTasksCount}</span>
          <span className="kpi-sub">{completedTasksCount} completed</span>
        </div>
        <div className="user-kpi-card">
          <span className="kpi-label">Hours Logged</span>
          <span className="kpi-value">{totalHoursLogged} hrs</span>
          <span className="kpi-sub">
            {work?.sessions ?? 0} {work?.sessions === 1 ? 'session' : 'sessions'} ({hm(sessionMs)}) · {userLogs.length} {userLogs.length === 1 ? 'log entry' : 'log entries'}
          </span>
        </div>
        <div className="user-kpi-card">
          <span className="kpi-label">Current Focus</span>
          <span className="kpi-value focus-text">
            {workingOn ? (workingOn.task?.title ?? 'General work') : userTasks.find((t) => workflow.get(t.status)?.category === 'doing')?.title || userLogs[0]?.title || 'Nothing in progress'}
          </span>
          <span className="kpi-sub">{workingOn ? `Working ${sessionSpan(workingOn)}` : 'Updated today'}</span>
        </div>
      </div>

      {/* Log Work Inline Modal/Form */}
      {showLogModal && (
        <div className="user-log-work-box">
          <div className="log-box-header">
            <h3>Log Work / Accomplishment for {member.name}</h3>
            <button type="button" className="team-modal-close" onClick={() => setShowLogModal(false)}>
              ×
            </button>
          </div>
          <form onSubmit={handleCreateLog} className="log-box-form">
            <input
              type="text"
              placeholder="What was completed or worked on?"
              value={logTitle}
              onChange={(e) => setLogTitle(e.target.value)}
              autoFocus
              required
            />
            <div className="log-box-controls">
              <select value={logCategory} onChange={(e) => setLogCategory(e.target.value as WorkCategory)}>
                {WORK_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="24"
                value={logHours}
                onChange={(e) => setLogHours(Number(e.target.value))}
                placeholder="Hours"
              />
              <button type="submit" className="team-btn-primary">
                Save work log
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="user-tabs-bar">
        <button
          type="button"
          className={`user-tab-btn ${activeTab === 'log' ? 'active' : ''}`}
          onClick={() => setActiveTab('log')}
        >
          Work log & activity ({timeline.length})
        </button>
        <button
          type="button"
          className={`user-tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          Assigned tasks ({userTasks.length})
        </button>
        <button
          type="button"
          className={`user-tab-btn ${activeTab === 'info' ? 'active' : ''}`}
          onClick={() => setActiveTab('info')}
        >
          Profile
        </button>
      </div>

      {/* Tab Content */}
      <div className="user-tab-content">
        {activeTab === 'log' && (
          <div className="user-timeline-section">
            {timeline.length === 0 ? (
              <div className="user-empty-state">
                <p>No work logs recorded yet for {member.name}.</p>
                <button type="button" className="team-btn-secondary" onClick={() => setShowLogModal(true)}>
                  + Log work
                </button>
              </div>
            ) : (
              <div className="user-timeline">
                {timeline.map((row) => {
                  if (row.kind === 'session') {
                    const s = row.session
                    const tasks = [...new Set(s.segments.map((g) => g.task?.taskKey ?? null))]
                    const last = s.updates?.at(-1)
                    return (
                      <button type="button" className="timeline-item timeline-session" key={`s-${s.id}`} onClick={() => setOpenSession(s)} aria-label={`Work session ${new Date(s.startedAt).toLocaleDateString()}, ${sessionSpan(s)}. Open details`}>
                        <div className="timeline-icon" aria-hidden="true">⏱</div>
                        <div className="timeline-content">
                          <div className="timeline-header">
                            <span className="timeline-title">Work session · {sessionSpan(s)}</span>
                            <span className="timeline-date">{new Date(s.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                          </div>
                          <div className="timeline-meta">
                            <span className="timeline-hours">{hm(liveMs(s.workedMs, s.runningSince, now))}</span>
                            <span className="timeline-cat">{tasks.map((k) => k ?? 'General work').join(', ')}</span>
                            {s.state !== 'stopped' && <span className="timeline-cat">{s.state === 'working' ? 'Working now' : 'Paused'}</span>}
                          </div>
                          {doneBySession.get(s.id) && <p className="timeline-note timeline-done">Done: {doneBySession.get(s.id)!.title}</p>}
                          {last && <p className="timeline-note">“{last.text}”{(s.updates?.length ?? 0) > 1 ? ` · ${s.updates!.length} updates` : ''}</p>}
                        </div>
                      </button>
                    )
                  }
                  const log = row.log
                  const cat = WORK_CATEGORIES.find((c) => c.id === log.category)
                  return (
                    <div className="timeline-item" key={log.id}>
                      <div className="timeline-icon">{cat?.icon || '✅'}</div>
                      <div className="timeline-content">
                        <div className="timeline-header">
                          <span className="timeline-title">{log.title}</span>
                          <span className="timeline-date">{log.day}</span>
                        </div>
                        <div className="timeline-meta">
                          <span className="timeline-cat">{cat?.label || 'Work'}</span>
                          {log.hoursSpent ? <span className="timeline-hours">&bull; {log.hoursSpent} hours</span> : null}
                          {log.taskKey ? <TaskLink taskKey={log.taskKey} className="timeline-key">Task {log.taskKey}</TaskLink> : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="user-tasks-section">
            <div className="user-section-header">
              <h3>Tasks assigned to {member.name}</h3>
              <button type="button" className="team-btn-primary" onClick={() => onAssignTask(member.id)}>
                + Assign task
              </button>
            </div>

            {userTasks.length === 0 ? (
              <div className="user-empty-state">
                <p>No tasks currently assigned to {member.name}.</p>
                <button type="button" className="team-btn-primary" onClick={() => onAssignTask(member.id)}>
                  + Assign task
                </button>
              </div>
            ) : (
              <div className="user-tasks-list">
                {userTasks.map((t: CalTask) => {
                  const isDone = workflow.isDone(t.status)
                  return (
                    <div className={`user-task-card ${isDone ? 'done' : ''}`} key={t.id}>
                      <div className="task-left">
                        <button
                          type="button"
                          className={`task-checkbox ${isDone ? 'checked' : ''}`}
                          onClick={() => updateTaskStatus(t.id, isDone ? workflow.firstTodo : workflow.firstDone)}
                          title={isDone ? 'Mark in progress' : 'Mark done'}
                        >
                          {isDone ? '✓' : ''}
                        </button>
                        <div className="task-info">
                          <span className="task-key-badge">{t.taskKey}</span>
                          {t.pending ? <span className="task-title-text">{t.title}</span> : <TaskLink taskKey={t.taskKey} className="task-title-text">{t.title}</TaskLink>}
                          {t.description && <p className="task-desc-text">{t.description}</p>}
                        </div>
                      </div>

                      <div className="task-right">
                        <span className={`priority-pill priority-${t.priority || 'medium'}`}>
                          {t.priority || 'medium'}
                        </span>
                        <select
                          className="task-status-select"
                          value={t.status}
                          onChange={(e) => updateTaskStatus(t.id, e.target.value)}
                        >
                          {workflow.active.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                        {t.dueDate && <span className="task-due-date">Due {t.dueDate}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'info' && (
          <div className="user-info-section">
            <div className="info-grid">
              <div className="info-block">
                <h4>Role & department</h4>
                <p>{member.role || 'Member'}</p>
                {member.department && <p className="text-muted">Department: {member.department}</p>}
              </div>
              <div className="info-block">
                <h4>Contact details</h4>
                {member.email ? <p>Email: {member.email}</p> : <p className="text-muted">No email shared.</p>}
                {member.tag && <p>Handle: {member.tag}</p>}
              </div>
              {member.skills?.length ? (
                <div className="info-block">
                  <h4>Skills & expertise</h4>
                  <div className="skills-tags">
                    {member.skills.map((s) => (
                      <span className="skill-tag" key={s}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {member.bio && (
                <div className="info-block">
                  <h4>Summary & notes</h4>
                  <p className="user-bio">{member.bio}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {openSession && <SessionDetail session={openSession} onClose={() => setOpenSession(null)} />}
    </div>
  )
}
