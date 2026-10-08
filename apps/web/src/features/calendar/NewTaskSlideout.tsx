import { useState } from 'react'
import { FormSlideout } from '../work/FormSlideout'
import { useCurrentWorkspace } from '../documents/workspace'
import { useWorkspaceMembers } from '@project/sdk'
import { useCalendar } from './store'
import { DEFAULT_TEAM } from './UserAvatarBar'

export function NewTaskSlideout({
  initialDay,
  onClose,
}: {
  initialDay: string
  onClose: () => void
}) {
  const { workspace } = useCurrentWorkspace()
  const membersQuery = useWorkspaceMembers(workspace?.id)
  const activeUserId = useCalendar((state) => state.activeUserId)
  const add = useCalendar((state) => state.add)

  const serverMembers = (membersQuery.data ?? [])
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.id, name: m.user.name }))

  const teamMembers = serverMembers.length > 0
    ? serverMembers
    : DEFAULT_TEAM.map((m) => ({ id: m.id, name: m.name }))

  const defaultAssigneeId = activeUserId !== 'all' ? activeUserId : (teamMembers[0]?.id ?? '')

  const [title, setTitle] = useState('')
  const [day, setDay] = useState(initialDay)
  const [time, setTime] = useState('')
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId)

  const close = () => {
    if ((!title && day === initialDay && !time) || window.confirm('Discard unsaved changes?')) onClose()
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !day) return

    const selectedMember = teamMembers.find((m) => m.id === assigneeId)

    add({
      title,
      day,
      time: time || null,
      assigneeId: selectedMember?.id ?? null,
      assigneeName: selectedMember?.name ?? null,
    })
    onClose()
  }

  return (
    <FormSlideout title="New Task" onClose={close}>
      <form className="record-form" onSubmit={handleSubmit}>
        <div className="record-form-fields">
          <label>
            <span>Task Title</span>
            <input
              autoFocus
              required
              placeholder="e.g. Review Q4 Roadmap & Assign Deliverables"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>Assignee</span>
            <select
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">Unassigned</option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Date</span>
            <input
              type="date"
              required
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </label>
          <label>
            <span>Time (optional)</span>
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        </div>
        <footer>
          <button type="button" onClick={close}>Cancel</button>
          <button type="submit" className="record-primary" disabled={!title.trim() || !day}>
            Assign & Create Task
          </button>
        </footer>
      </form>
    </FormSlideout>
  )
}
