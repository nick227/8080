import { useState } from 'react'
import { useCurrentWorkspace } from '../documents/workspace'
import { useWorkspaceMembers } from '@project/sdk'
import { useCalendar } from './store'
import { DEFAULT_TEAM } from './UserAvatarBar'
import { todayKey } from './dates'

export function LogAccomplishmentModal({
  initialDay,
  onClose,
}: {
  initialDay: string
  onClose: () => void
}) {
  const { workspace } = useCurrentWorkspace()
  const membersQuery = useWorkspaceMembers(workspace?.id)
  const activeUserId = useCalendar((state) => state.activeUserId)
  const addAccomplishment = useCalendar((state) => state.addAccomplishment)
  const findTaskByNumber = useCalendar((state) => state.findTaskByNumber)
  const updateTaskStatus = useCalendar((state) => state.updateTaskStatus)

  const serverMembers = (membersQuery.data ?? [])
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.id, name: m.user.name }))

  const teamMembers = serverMembers.length > 0
    ? serverMembers
    : DEFAULT_TEAM.map((m) => ({ id: m.id, name: m.name }))

  const defaultAssigneeId = activeUserId !== 'all' ? activeUserId : (teamMembers[0]?.id ?? '')

  const [taskNumber, setTaskNumber] = useState('')
  const [title, setTitle] = useState('')
  const [day, setDay] = useState(initialDay || todayKey())
  const [time, setTime] = useState('')
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId)
  const [updateTaskChecked, setUpdateTaskChecked] = useState(true)

  // Find matching task dynamically if task number is entered
  const matchedTask = taskNumber.trim() ? findTaskByNumber(taskNumber) : null

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const finalTitle = title.trim() || (matchedTask ? `Completed work on ${matchedTask.taskKey}` : '')
    if (!finalTitle || !day) return

    const selectedMember = teamMembers.find((m) => m.id === assigneeId)

    // Log the work accomplishment
    addAccomplishment({
      title: matchedTask ? `[${matchedTask.taskKey}] ${finalTitle}` : finalTitle,
      taskKey: matchedTask?.taskKey ?? (taskNumber.trim() ? taskNumber.trim().toUpperCase() : null),
      day,
      time: time || null,
      category: 'work',
      icon: '✅',
      assigneeId: selectedMember?.id ?? matchedTask?.assigneeId ?? null,
      assigneeName: selectedMember?.name ?? matchedTask?.assigneeName ?? null,
    })

    // If valid ticket number entered and "Update Task" is checked, settle the task
    if (matchedTask && updateTaskChecked) {
      updateTaskStatus(matchedTask.id, 'done')
    }

    onClose()
  }

  return (
    <div className="cal-modal" role="dialog" aria-modal="true" aria-labelledby="log-acc-title">
      <div className="cal-dialog cal-log-work-dialog">
        <div className="cal-dialog-header">
          <h2 id="log-acc-title">📝 Log Work & Update Ticket</h2>
          <p className="cal-dialog-sub">Log activity or settle existing tasks by Task Number</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="cal-field">
            <span>Task / Ticket Number (Optional)</span>
            <input
              autoFocus
              placeholder="e.g. VC-101 or 101"
              value={taskNumber}
              onChange={(e) => setTaskNumber(e.target.value)}
            />
          </div>

          {/* Valid Task Preview & Settlement Checkbox */}
          {matchedTask ? (
            <div className="cal-task-match-box">
              <div className="cal-match-info">
                <span className="cal-match-badge">✓ Found Task</span>
                <strong className="cal-match-key">{matchedTask.taskKey}</strong>
                <span className="cal-match-title">{matchedTask.title}</span>
              </div>
              <label className="cal-match-checkbox">
                <input
                  type="checkbox"
                  checked={updateTaskChecked}
                  onChange={(e) => setUpdateTaskChecked(e.target.checked)}
                />
                <span><strong>Update Task:</strong> Mark this task as Settled / Done (Crosses out task in calendar)</span>
              </label>
            </div>
          ) : taskNumber.trim() ? (
            <div className="cal-task-no-match">
              <span>⚠️ No matching open task found for "{taskNumber}". Work will be logged as a standalone accomplishment.</span>
            </div>
          ) : null}

          <div className="cal-field">
            <span>Work Summary</span>
            <input
              required={!matchedTask}
              placeholder={matchedTask ? `Brief note (Optional - defaults to "${matchedTask.title}")` : "Brief description of the completed work..."}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="cal-field">
            <span>Member Responsible</span>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Whole Team</option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          <div className="cal-field-pair">
            <div className="cal-field">
              <span>Date</span>
              <input type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div className="cal-field">
              <span>Time (Optional)</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <div className="cal-actions">
            <button type="button" className="cal-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="cal-btn"
              data-primary=""
              disabled={(!title.trim() && !matchedTask) || !day}
            >
              Save Work
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
