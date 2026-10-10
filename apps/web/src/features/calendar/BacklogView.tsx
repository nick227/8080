import type { CalTask } from './types'
import { wf } from './store'

export function BacklogView({
  tasks,
  onSelectTask,
  onUpdateStatus,
}: {
  tasks: CalTask[]
  onSelectTask: (task: CalTask) => void
  onUpdateStatus: (taskId: string, status: string) => void
}) {
  const backlogTasks = tasks.filter(t => !wf().isDone(t.status))

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

  return (
    <div className="cal-backlog-view" role="region" aria-label="Open task backlog">
      <div className="cal-backlog-container">
        {/* Product Backlog Section */}
        <section className="cal-backlog-section">
          <header className="cal-backlog-header">
            <div className="cal-backlog-header-left">
              <h3>Open tasks</h3>
              <span className="cal-backlog-count">{backlogTasks.length} issues</span>
            </div>

          </header>

          <div className="cal-backlog-list">
            {backlogTasks.map((task) => (
              <BacklogRow
                key={task.id}
                task={task}
                categoryIcons={categoryIcons}
                priorityColors={priorityColors}
                onSelectTask={onSelectTask}
                onUpdateStatus={onUpdateStatus}
              />
            ))}

            {backlogTasks.length === 0 && (
              <p className="cal-backlog-empty">No open tasks match these filters.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function BacklogRow({
  task,
  categoryIcons,
  priorityColors,
  onSelectTask,
  onUpdateStatus,
}: {
  task: CalTask
  categoryIcons: Record<string, string>
  priorityColors: Record<string, string>
  onSelectTask: (task: CalTask) => void
  onUpdateStatus: (taskId: string, status: string) => void
}) {
  const done = wf().isDone(task.status)

  return (
    <div className="cal-backlog-row" data-done={done ? '' : undefined}>
      <select
        aria-label={`Status for ${task.title}`}
        className="cal-status-pill"
        data-status={task.status}
        value={task.status}
        onChange={(e) => onUpdateStatus(task.id, e.target.value as any)}
      >
        <option value="open">⚪ Open</option>
        <option value="in_progress">🔵 In Progress</option>
        <option value="in_review">🟡 In Review</option>
        <option value="done">✅ Done</option>
      </select>

      <button type="button" className="cal-backlog-main" onClick={() => onSelectTask(task)}>
        <span className="cal-ticket-key-tag">{task.taskKey}</span>
        <span className="cal-cat-icon">{categoryIcons[task.category || 'task'] || '📌'}</span>
        <span className="cal-backlog-title">{task.title}</span>
        {task.area && <span className="cal-area-chip">{task.area}</span>}
      </button>

      <div className="cal-backlog-meta">
        {task.dueDate && <span className="cal-due-chip">📅 {task.dueDate}</span>}
        <span className="cal-priority-dot" style={{ color: priorityColors[task.priority || 'medium'] }}>
          ● {task.priority?.toUpperCase()}
        </span>
        {task.assigneeName ? (
          <span className="cal-task-assignee-badge">👤 {task.assigneeName}</span>
        ) : (
          <span className="cal-unassigned-tag">Unassigned</span>
        )}
        
      </div>
    </div>
  )
}
