import { useState } from 'react'
import { FormSlideout } from '../work/FormSlideout'
import { useCalendar } from './store'
import { useTeam } from './sync'

export function NewTaskSlideout({
  initialDay,
  onClose,
}: {
  initialDay: string
  onClose: () => void
}) {
  const { team: teamMembers, meId } = useTeam()
  const members = useCalendar((state) => state.filters.members)
  const add = useCalendar((state) => state.add)

  // Filtering by one person suggests them; otherwise the creator.
  const defaultAssigneeId = members.length === 1 && members[0] !== 'unassigned' ? members[0] : (meId ?? '')

  const [title, setTitle] = useState('')
  const [day, setDay] = useState(initialDay)
  const [time, setTime] = useState('')
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId)

  const close = () => {
    if ((!title && day === initialDay && !time) || window.confirm('Discard unsaved changes?')) onClose()
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return

    const selectedMember = teamMembers.find((m) => m.id === assigneeId)

    add({
      title,
      day: day || null,
      time: day ? time || null : null,
      assigneeId: selectedMember?.id ?? null,
      assigneeName: selectedMember?.name ?? null,
      assigneeAvatar: selectedMember?.avatarUrl ?? null,
    })
    onClose()
  }

  return (
    <FormSlideout title="New task" onClose={close}>
      <form className="record-form" onSubmit={handleSubmit}>
        <div className="record-form-fields">
          <label>
            <span>Title</span>
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
            <span>Date (optional; without one it lives on the board)</span>
            <input
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </label>
          <label>
            <span>Time (optional)</span>
            <input
              type="time"
              value={time}
              disabled={!day}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        </div>
        <footer>
          <button type="button" onClick={close}>Cancel</button>
          <button type="submit" className="record-primary" disabled={!title.trim()}>
            Create task
          </button>
        </footer>
      </form>
    </FormSlideout>
  )
}
