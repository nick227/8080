import { useState } from 'react'
import { FormSlideout } from '../work/FormSlideout'
import { useCurrentWorkspace } from '../documents/workspace'
import { useWorkspaceMembers } from '@project/sdk'
import { useCalendar } from './store'
import { DEFAULT_TEAM } from './UserAvatarBar'
import type { CalTask } from './types'

export function TaskDetailSlideout({
  task,
  onClose,
}: {
  task: CalTask
  onClose: () => void
}) {
  const { workspace } = useCurrentWorkspace()
  const membersQuery = useWorkspaceMembers(workspace?.id)
  const updateTask = useCalendar((state) => state.updateTask)
  const updateTaskStatus = useCalendar((state) => state.updateTaskStatus)
  const addComment = useCalendar((state) => state.addComment)

  const serverMembers = (membersQuery.data ?? [])
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.id, name: m.user.name }))

  const teamMembers = serverMembers.length > 0
    ? serverMembers
    : DEFAULT_TEAM.map((m) => ({ id: m.id, name: m.name }))

  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || '')
  const [status, setStatus] = useState(task.status)
  const [assigneeId, setAssigneeId] = useState(task.assigneeId || '')
  const [priority, setPriority] = useState(task.priority || 'medium')
  const [category, setCategory] = useState(task.category || 'task')
  const [area, setArea] = useState(task.area || 'Engineering')
  const [storyPoints, setStoryPoints] = useState(task.storyPoints || 3)
  const [day, setDay] = useState(task.day)
  const [time, setTime] = useState(task.time || '')
  const [dueDate, setDueDate] = useState(task.dueDate || '')
  const [commentText, setCommentText] = useState('')

  const priorityColors: Record<string, string> = {
    low: '#3b82f6',
    medium: '#eab308',
    high: '#f97316',
    highest: '#ef4444',
  }

  const categoryIcons: Record<string, string> = {
    feature: '⚡',
    bug: '🐛',
    task: '📌',
    story: '🟢',
    epic: '🟣',
  }

  const handleStatusChange = (newStatus: 'open' | 'in_progress' | 'in_review' | 'done') => {
    setStatus(newStatus)
    updateTaskStatus(task.id, newStatus)
  }

  const handleSaveDetails = () => {
    const selectedMember = teamMembers.find((m) => m.id === assigneeId)
    updateTask(task.id, {
      title: title.trim(),
      description: description.trim() || null,
      status,
      assigneeId: selectedMember?.id || null,
      assigneeName: selectedMember?.name || null,
      priority,
      category,
      area: area as any,
      storyPoints: Number(storyPoints) || 1,
      day,
      time: time || null,
      dueDate: dueDate || null,
    })
    onClose()
  }

  const handlePostComment = (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim()) return
    addComment(task.id, commentText.trim(), 'Leadership User')
    setCommentText('')
  }

  return (
    <FormSlideout title={`Ticket ${task.taskKey}`} onClose={onClose}>
      <div className="cal-task-detail-pane">
        {/* Ticket Top Meta Ribbon */}
        <div className="cal-detail-header-ribbon">
          <span className="cal-ticket-key-badge">{task.taskKey}</span>
          <span className="cal-cat-badge" data-cat={category}>
            {categoryIcons[category] || '📌'} {category.toUpperCase()}
          </span>
          <span
            className="cal-priority-badge"
            style={{ color: priorityColors[priority] || '#eab308' }}
          >
            ● {priority.toUpperCase()} PRIORITY
          </span>
          <span className="cal-area-chip">{area}</span>
        </div>

        {/* Status Dropdown */}
        <div className="cal-status-row">
          <label>Status:</label>
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
        </div>

        {/* Editable Title & Description */}
        <div className="record-form-fields">
          <label>
            <span>Summary / Title</span>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label>
            <span>Description & Acceptance Criteria</span>
            <textarea
              rows={4}
              placeholder="Add details, acceptance criteria, technical design notes..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="cal-field-pair">
            <label>
              <span>Assignee</span>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Story Points</span>
              <select
                value={storyPoints}
                onChange={(e) => setStoryPoints(Number(e.target.value))}
              >
                <option value={1}>1 Point (Small)</option>
                <option value={2}>2 Points (Minor)</option>
                <option value={3}>3 Points (Medium)</option>
                <option value={5}>5 Points (Large)</option>
                <option value={8}>8 Points (Epic / Complex)</option>
              </select>
            </label>
          </div>

          <div className="cal-field-pair">
            <label>
              <span>Issue Type</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as any)}>
                <option value="feature">⚡ Feature</option>
                <option value="story">🟢 Story</option>
                <option value="bug">🐛 Bug Fix</option>
                <option value="task">📌 Task</option>
                <option value="epic">🟣 Epic</option>
              </select>
            </label>

            <label>
              <span>Workspace Area</span>
              <select value={area} onChange={(e) => setArea(e.target.value as any)}>
                <option value="Engineering">🛠️ Engineering</option>
                <option value="Marketing">📣 Marketing</option>
                <option value="Operations">⚙️ Operations</option>
                <option value="Design">🎨 Design</option>
                <option value="Product">🎯 Product</option>
                <option value="Sales">💼 Sales</option>
              </select>
            </label>
          </div>

          <div className="cal-field-pair">
            <label>
              <span>Priority</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value as any)}>
                <option value="low">🔵 Low</option>
                <option value="medium">🟡 Medium</option>
                <option value="high">🟠 High</option>
                <option value="highest">🔴 Highest</option>
              </select>
            </label>

            <label>
              <span>Due Date</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>

          <div className="cal-field-pair">
            <label>
              <span>Scheduled Date</span>
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label>
              <span>Time Slot (Optional)</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
        </div>

        {/* Slideout Comments Section */}
        <div className="cal-comments-section">
          <h3>💬 Activity & Discussion ({task.comments?.length || 0})</h3>

          <form className="cal-add-comment-form" onSubmit={handlePostComment}>
            <input
              placeholder="Add a comment or update..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
            />
            <button type="submit" className="cal-btn" data-primary="" disabled={!commentText.trim()}>
              Post
            </button>
          </form>

          <div className="cal-comments-list">
            {(task.comments ?? []).length > 0 ? (
              task.comments!.map((c) => (
                <div key={c.id} className="cal-comment-card">
                  <div className="cal-comment-header">
                    <strong>{c.authorName}</strong>
                    <time>{c.createdAt}</time>
                  </div>
                  <p className="cal-comment-text">{c.text}</p>
                </div>
              ))
            ) : (
              <p className="cal-no-comments">No comments yet. Start the conversation above.</p>
            )}
          </div>
        </div>

        <footer className="cal-detail-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="record-primary" onClick={handleSaveDetails}>
            Save Ticket Changes
          </button>
        </footer>
      </div>
    </FormSlideout>
  )
}
