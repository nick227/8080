import { useState, useEffect } from 'react'
import { useCurrentWorkspace } from '../documents/workspace'
import { useWorkspaceMembers } from '@project/sdk'
import { useCalendar } from './store'
import { DEFAULT_TEAM } from './UserAvatarBar'
import type { CalTask } from './types'

export function TicketPage({
  taskKey,
  onBack,
}: {
  taskKey: string
  onBack: () => void
}) {
  const { workspace } = useCurrentWorkspace()
  const membersQuery = useWorkspaceMembers(workspace?.id)
  const findTaskByNumber = useCalendar((state) => state.findTaskByNumber)
  const updateTask = useCalendar((state) => state.updateTask)
  const updateTaskStatus = useCalendar((state) => state.updateTaskStatus)
  const addComment = useCalendar((state) => state.addComment)
  const remove = useCalendar((state) => state.remove)
  const accomplishments = useCalendar((state) => state.accomplishments)

  const task = findTaskByNumber(taskKey)

  const serverMembers = (membersQuery.data ?? [])
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.id, name: m.user.name }))

  const teamMembers = serverMembers.length > 0
    ? serverMembers
    : DEFAULT_TEAM.map((m) => ({ id: m.id, name: m.name }))

  const [title, setTitle] = useState(task?.title || '')
  const [description, setDescription] = useState(task?.description || '')
  const [status, setStatus] = useState<CalTask['status']>(task?.status || 'open')
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId || '')
  const [priority, setPriority] = useState(task?.priority || 'medium')
  const [category, setCategory] = useState(task?.category || 'task')
  const [area, setArea] = useState(task?.area || 'Engineering')
  const [storyPoints, setStoryPoints] = useState(task?.storyPoints || 3)
  const [sprint, setSprint] = useState(task?.sprint || 'Sprint 24')
  const [day, setDay] = useState(task?.day || '')
  const [time, setTime] = useState(task?.time || '')
  const [dueDate, setDueDate] = useState(task?.dueDate || '')
  const [commentText, setCommentText] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description || '')
      setStatus(task.status)
      setAssigneeId(task.assigneeId || '')
      setPriority(task.priority || 'medium')
      setCategory(task.category || 'task')
      setArea(task.area || 'Engineering')
      setStoryPoints(task.storyPoints || 3)
      setSprint(task.sprint || 'Sprint 24')
      setDay(task.day)
      setTime(task.time || '')
      setDueDate(task.dueDate || '')
    }
  }, [task])

  if (!task) {
    return (
      <div className="ticket-page-missing">
        <header className="ticket-page-nav-bar">
          <button type="button" className="cal-btn" onClick={onBack}>
            ← Back to Calendar
          </button>
        </header>
        <div className="ticket-missing-body">
          <h2>Ticket Not Found</h2>
          <p>The requested ticket key "{taskKey}" could not be found or has been removed.</p>
          <button type="button" className="cal-btn" data-primary="" onClick={onBack}>
            Return to Calendar & Tasks
          </button>
        </div>
      </div>
    )
  }

  const categoryIcons: Record<string, string> = {
    feature: '⚡',
    bug: '🐛',
    task: '📌',
    story: '🟢',
    epic: '🟣',
  }

  const priorityColors: Record<string, string> = {
    low: '#3b82f6',
    medium: '#eab308',
    high: '#f97316',
    highest: '#ef4444',
  }

  const handleStatusChange = (newStatus: CalTask['status']) => {
    setStatus(newStatus)
    updateTaskStatus(task.id, newStatus)
  }

  const handleSave = () => {
    const selectedMember = teamMembers.find((m) => m.id === assigneeId)
    updateTask(task.id, {
      title: title.trim() || task.title,
      description: description.trim() || null,
      status,
      assigneeId: selectedMember?.id || null,
      assigneeName: selectedMember?.name || null,
      priority,
      category,
      area: area as any,
      storyPoints: Number(storyPoints) || 1,
      sprint,
      day,
      time: time || null,
      dueDate: dueDate || null,
    })
  }

  const handlePostComment = (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim()) return
    addComment(task.id, commentText.trim(), 'Leadership User')
    setCommentText('')
  }

  const handleCopyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?desk=calendar&ticket=${task.taskKey}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleDelete = () => {
    if (window.confirm(`Delete ticket ${task.taskKey}? This action cannot be undone.`)) {
      remove(task.id)
      onBack()
    }
  }

  const relatedWorkLogs = accomplishments.filter(
    (a) => a.taskKey?.toUpperCase() === task.taskKey.toUpperCase() || a.title.includes(task.taskKey)
  )

  return (
    <div className="ticket-page-view" role="main" aria-label={`Ticket ${task.taskKey}`}>
      {/* Top Header Navigation Bar */}
      <header className="ticket-page-nav-bar">
        <div className="ticket-nav-left">
          <button type="button" className="cal-btn" onClick={onBack} title="Back to Calendar & Tasks">
            ← Back to Calendar
          </button>

          <span className="ticket-page-key-badge">{task.taskKey}</span>

          <button
            type="button"
            className="cal-btn ticket-copy-btn"
            onClick={handleCopyLink}
            title="Copy unique URL link for this ticket"
          >
            {copied ? '✓ Link Copied!' : '🔗 Copy Ticket Link'}
          </button>
        </div>

        <div className="ticket-nav-right">
          <label className="ticket-status-label">Status:</label>
          <select
            className="cal-status-select"
            data-status={status}
            value={status}
            onChange={(e) => handleStatusChange(e.target.value as any)}
          >
            <option value="open">⚪ Open / To Do</option>
            <option value="in_progress">🔵 In Progress</option>
            <option value="in_review">🟡 In Review</option>
            <option value="done">✅ Done</option>
          </select>

          <button type="button" className="cal-btn" onClick={handleSave} data-primary="">
            Save Ticket
          </button>

          <button type="button" className="cal-btn ticket-delete-btn" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </header>

      {/* Main Ticket Page 2-Column Content Layout */}
      <div className="ticket-page-container">
        {/* Left / Main Column */}
        <div className="ticket-main-col">
          {/* Editable Title */}
          <div className="ticket-title-wrap">
            <input
              className="ticket-title-input"
              value={title}
              placeholder="Ticket summary..."
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleSave}
            />
          </div>

          {/* Description & Acceptance Criteria */}
          <div className="ticket-section">
            <h3 className="ticket-section-heading">Description & Acceptance Criteria</h3>
            <textarea
              className="ticket-description-textarea"
              rows={6}
              placeholder="Add comprehensive details, acceptance criteria, technical design notes, or bug reproduction steps..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleSave}
            />
          </div>

          {/* Linked Work Logs / Accomplishments */}
          {relatedWorkLogs.length > 0 && (
            <div className="ticket-section">
              <h3 className="ticket-section-heading">📝 Work Logs & Activity History ({relatedWorkLogs.length})</h3>
              <div className="ticket-work-logs-list">
                {relatedWorkLogs.map((log) => (
                  <div key={log.id} className="ticket-work-log-card">
                    <span className="ticket-log-icon">{log.icon || '✅'}</span>
                    <div className="ticket-log-info">
                      <strong>{log.title}</strong>
                      <span className="ticket-log-meta">
                        {log.assigneeName ? `@${log.assigneeName} · ` : ''}
                        {log.day} {log.time ? `at ${log.time}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comments & Activity Discussion Thread */}
          <div className="ticket-section">
            <h3 className="ticket-section-heading">💬 Activity & Discussion ({task.comments?.length || 0})</h3>

            <form className="ticket-comment-composer" onSubmit={handlePostComment}>
              <input
                className="ticket-comment-input"
                placeholder="Write a comment or post an update..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              />
              <button type="submit" className="cal-btn" data-primary="" disabled={!commentText.trim()}>
                Post Comment
              </button>
            </form>

            <div className="ticket-comments-thread">
              {(task.comments ?? []).length > 0 ? (
                task.comments!.map((comment) => (
                  <div key={comment.id} className="ticket-comment-bubble">
                    <div className="ticket-comment-header">
                      <strong className="ticket-comment-author">👤 {comment.authorName}</strong>
                      <time className="ticket-comment-time">{comment.createdAt}</time>
                    </div>
                    <p className="ticket-comment-text">{comment.text}</p>
                  </div>
                ))
              ) : (
                <p className="ticket-no-comments">No comments on this ticket yet. Start the discussion above.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar Column */}
        <aside className="ticket-sidebar-col">
          <div className="ticket-meta-box">
            <h3 className="ticket-meta-box-title">Ticket Details</h3>

            <div className="ticket-meta-field">
              <label>Assignee</label>
              <select
                value={assigneeId}
                onChange={(e) => {
                  setAssigneeId(e.target.value)
                  handleSave()
                }}
              >
                <option value="">Unassigned</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="ticket-meta-field">
              <label>Issue Type</label>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as any)
                  handleSave()
                }}
              >
                <option value="feature">⚡ Feature</option>
                <option value="story">🟢 Story</option>
                <option value="bug">🐛 Bug Fix</option>
                <option value="task">📌 Task</option>
                <option value="epic">🟣 Epic</option>
              </select>
            </div>

            <div className="ticket-meta-field">
              <label>Workspace Area</label>
              <select
                value={area}
                onChange={(e) => {
                  setArea(e.target.value as any)
                  handleSave()
                }}
              >
                <option value="Engineering">🛠️ Engineering</option>
                <option value="Marketing">📣 Marketing</option>
                <option value="Operations">⚙️ Operations</option>
                <option value="Design">🎨 Design</option>
                <option value="Product">🎯 Product</option>
                <option value="Sales">💼 Sales</option>
              </select>
            </div>

            <div className="ticket-meta-field">
              <label>Priority</label>
              <select
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value as any)
                  handleSave()
                }}
              >
                <option value="low">🔵 Low</option>
                <option value="medium">🟡 Medium</option>
                <option value="high">🟠 High</option>
                <option value="highest">🔴 Highest</option>
              </select>
            </div>

            <div className="ticket-meta-field">
              <label>Story Points</label>
              <select
                value={storyPoints}
                onChange={(e) => {
                  setStoryPoints(Number(e.target.value))
                  handleSave()
                }}
              >
                <option value={1}>1 Point (Small)</option>
                <option value={2}>2 Points (Minor)</option>
                <option value={3}>3 Points (Medium)</option>
                <option value={5}>5 Points (Large)</option>
                <option value={8}>8 Points (Epic / Complex)</option>
              </select>
            </div>

            <div className="ticket-meta-field">
              <label>Sprint</label>
              <select
                value={sprint}
                onChange={(e) => {
                  setSprint(e.target.value)
                  handleSave()
                }}
              >
                <option value="Sprint 24">🏃 Sprint 24 (Active)</option>
                <option value="Sprint 25">🏃 Sprint 25 (Next)</option>
                <option value="Backlog">📋 Product Backlog</option>
              </select>
            </div>

            <div className="ticket-meta-field">
              <label>Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value)
                  handleSave()
                }}
              />
            </div>

            <div className="ticket-meta-field">
              <label>Scheduled Date</label>
              <input
                type="date"
                value={day}
                onChange={(e) => {
                  setDay(e.target.value)
                  handleSave()
                }}
              />
            </div>

            <div className="ticket-meta-field">
              <label>Time Slot</label>
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value)
                  handleSave()
                }}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
