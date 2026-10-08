import type { CalTask } from './types'

export function BoardView({
  tasks,
  onSelectTask,
  onUpdateStatus,
}: {
  tasks: CalTask[]
  onSelectTask: (task: CalTask) => void
  onUpdateStatus: (taskId: string, status: 'open' | 'in_progress' | 'in_review' | 'done') => void
}) {
  const columns: { id: 'open' | 'in_progress' | 'in_review' | 'done'; title: string; badge: string; color: string }[] = [
    { id: 'open', title: 'To Do / Open', badge: '⚪', color: 'var(--muted)' },
    { id: 'in_progress', title: 'In Progress', badge: '🔵', color: '#3b82f6' },
    { id: 'in_review', title: 'In Review', badge: '🟡', color: '#eab308' },
    { id: 'done', title: 'Done', badge: '✅', color: '#10b981' },
  ]

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
    <div className="cal-board-view" role="region" aria-label="Tasks by status">
      <div className="cal-kanban-grid">
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.id)

          return (
            <div key={col.id} className="cal-kanban-column" data-status={col.id}>
              <div className="cal-kanban-header">
                <div className="cal-kanban-title-group">
                  <span className="cal-kanban-badge">{col.badge}</span>
                  <h3 className="cal-kanban-title">{col.title}</h3>
                  <span className="cal-kanban-count">{colTasks.length}</span>
                </div>
              </div>

              <div className="cal-kanban-cards">
                {colTasks.map((task) => {
                  const done = task.status === 'done'
                  return (
                    <div
                      key={task.id}
                      className="cal-kanban-card"
                      data-done={done ? '' : undefined}
                      onClick={() => onSelectTask(task)}
                    >
                      <div className="cal-card-top-row">
                        <span className="cal-ticket-key-tag">{task.taskKey}</span>
                        <span className="cal-cat-icon">{categoryIcons[task.category || 'task'] || '📌'}</span>
                        {task.area && <span className="cal-area-chip">{task.area}</span>}
                        <span
                          className="cal-priority-dot"
                          style={{ color: priorityColors[task.priority || 'medium'] }}
                          title={`Priority: ${task.priority}`}
                        >
                          ●
                        </span>
                      </div>

                      <h4 className="cal-card-title">{task.title}</h4>

                      {task.dueDate && (
                        <div className="cal-card-due">
                          📅 Due {task.dueDate}
                        </div>
                      )}

                      <div className="cal-card-bottom-row">
                        {task.assigneeName ? (
                          <span className="cal-task-assignee-badge">👤 {task.assigneeName}</span>
                        ) : (
                          <span className="cal-unassigned-tag">Unassigned</span>
                        )}

                        <div className="cal-card-right-tags">
                          {task.storyPoints && (
                            <span className="cal-points-badge">{task.storyPoints}pt</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}

                {colTasks.length === 0 && (
                  <div className="cal-kanban-empty">No tickets in {col.title}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
