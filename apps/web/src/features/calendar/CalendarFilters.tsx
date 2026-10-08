import { useCalendar } from './store'
import type { CalTask } from './types'

/** All filters apply to the dataset displayed by the selected view. */
export function CalendarFilters({ tasks, count }: { tasks: CalTask[]; count: number }) {
  const state = useCalendar()
  const people = [...new Map(tasks.filter(t => t.assigneeId).map(t => [t.assigneeId!, t.assigneeName || 'Assigned member'])).entries()]
  return <div className="cal-filters" aria-label="Filter current view">
    <label>Assignee<select aria-label="Assignee" value={state.activeUserId} onChange={e => state.setActiveUser(e.target.value)}><option value="all">Everyone</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}{state.activeUserId !== 'all' && !people.some(([id]) => id === state.activeUserId) && <option value={state.activeUserId}>Selected member (no tasks here)</option>}</select></label>
    <label>Type<select aria-label="Task type" value={state.categoryFilter} onChange={e => state.setCategoryFilter(e.target.value)}><option value="all">All types</option>{['task', 'feature', 'bug', 'story', 'epic'].map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}</select></label>
    <label>Priority<select aria-label="Task priority" value={state.priorityFilter} onChange={e => state.setPriorityFilter(e.target.value)}><option value="all">All priorities</option><option value="high">High and highest</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
    <span className="cal-view-count" aria-live="polite">{count} tasks in this view</span>
    {(state.activeUserId !== 'all' || state.categoryFilter !== 'all' || state.priorityFilter !== 'all') && <button className="cal-btn" type="button" onClick={() => { state.setActiveUser('all'); state.setCategoryFilter('all'); state.setPriorityFilter('all') }}>Clear filters</button>}
  </div>
}
