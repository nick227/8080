import { useState } from 'react'
import { useCalendar } from '../calendar/store'
import { useTeam } from '../calendar/sync'
import { AREAS, TASK_TYPES, type TaskPriority, type TaskType } from '../calendar/types'
import { todayKey } from '../calendar/dates'
import './team.css'

export function AssignTaskModal({
  assigneeId,
  assigneeName,
  assigneeAvatar,
  onClose,
}: {
  assigneeId?: string | null
  assigneeName?: string | null
  assigneeAvatar?: string | null
  onClose: () => void
}) {
  const addTask = useCalendar((s) => s.add)
  const { team } = useTeam()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>(assigneeId ?? (team[0]?.id || ''))
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [category, setCategory] = useState<TaskType>('task')
  const [area, setArea] = useState<string>(AREAS[0])
  const [dueDate, setDueDate] = useState<string>(todayKey())
  const [storyPoints, setStoryPoints] = useState<number>(2)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    const matchedMember = team.find((m) => m.id === selectedAssigneeId)
    const targetName = matchedMember?.name ?? assigneeName ?? undefined
    const targetAvatar = matchedMember?.avatarUrl ?? assigneeAvatar ?? undefined

    addTask({
      title: title.trim(),
      description: description.trim() || null,
      assigneeId: selectedAssigneeId || null,
      assigneeName: targetName,
      assigneeAvatar: targetAvatar,
      priority,
      category,
      area,
      dueDate: dueDate || null,
      day: dueDate || null,
      storyPoints: storyPoints || null,
      status: 'todo',
    })

    useCalendar.getState().say(`Assigned task "${title.trim()}" to ${targetName || 'team member'}`)
    onClose()
  }

  return (
    <div className="team-modal-backdrop" onClick={onClose}>
      <div className="team-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="team-modal-header">
          <h2 id="modal-title">Assign Task</h2>
          <button type="button" className="team-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="team-modal-form">
          <div className="team-form-field">
            <label htmlFor="task-title">Task Title *</label>
            <input
              id="task-title"
              type="text"
              placeholder="e.g. Implement real-time waveform visualization"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="team-form-field">
            <label htmlFor="task-desc">Description</label>
            <textarea
              id="task-desc"
              placeholder="Details, requirements, or links..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="team-form-row">
            <div className="team-form-field">
              <label htmlFor="task-assignee">Assignee</label>
              <select
                id="task-assignee"
                value={selectedAssigneeId}
                onChange={(e) => setSelectedAssigneeId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="team-form-field">
              <label htmlFor="task-priority">Priority</label>
              <select
                id="task-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="highest">Highest</option>
              </select>
            </div>
          </div>

          <div className="team-form-row">
            <div className="team-form-field">
              <label htmlFor="task-category">Issue Type</label>
              <select
                id="task-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as TaskType)}
              >
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div className="team-form-field">
              <label htmlFor="task-area">Area / Dept</label>
              <select
                id="task-area"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                {AREAS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="team-form-row">
            <div className="team-form-field">
              <label htmlFor="task-due">Due Date</label>
              <input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <div className="team-form-field">
              <label htmlFor="task-points">Story Points</label>
              <input
                id="task-points"
                type="number"
                min="1"
                max="13"
                value={storyPoints}
                onChange={(e) => setStoryPoints(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="team-modal-actions">
            <button type="button" className="team-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="team-btn-primary" disabled={!title.trim()}>
              Assign Task
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
