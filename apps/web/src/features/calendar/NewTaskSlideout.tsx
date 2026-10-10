import { useState } from 'react'
import { FormSlideout } from '../work/FormSlideout'
import { useCalendar } from './store'
import type { TaskPriority } from './types'
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
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [day, setDay] = useState(initialDay)
  const [time, setTime] = useState('')
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId)

  const close = () => {
    if ((!title && !description && !dueDate && priority === 'medium' && day === initialDay && !time && assigneeId === defaultAssigneeId) || window.confirm('Discard unsaved changes?')) onClose()
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return

    const selectedMember = teamMembers.find((m) => m.id === assigneeId)

    add({
      title: title.trim(),
      description: description.trim() || null,
      dueDate: dueDate || null,
      priority,
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
              maxLength={255}
              placeholder="What needs to be done?"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label><span>Description (optional)</span><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add context and what a good result looks like." /></label>
          <label><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="highest">Highest</option>
          </select></label>
          <label><span>Due date (optional)</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
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
            <span>Schedule on calendar (optional)</span>
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
