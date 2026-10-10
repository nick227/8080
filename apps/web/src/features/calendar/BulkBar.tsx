import { useMemo } from 'react'
import { FIELDS, FIELD_ORDER, assignToMe, deleteTasks, openField } from './actions'
import { useCalendar } from './store'
import { useTeam } from './sync'

/** Actions for the selection, through the same pickers as one card. */
export function BulkBar() {
  const selection = useCalendar((s) => s.selection)
  const tasks = useCalendar((s) => s.tasks)
  const clear = useCalendar((s) => s.clearSelection)
  const { team, meId } = useTeam()
  const taskSet = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])
  const ids = useMemo(() => selection.filter((id) => taskSet.has(id)), [selection, taskSet])
  if (!ids.length) return null
  return (
    <div className="cal-bulkbar" role="toolbar" aria-label={`${ids.length} selected`}>
      <strong>{ids.length} selected</strong>
      {FIELD_ORDER.map((f) => (
        <button key={f} type="button" className="cal-btn" onClick={(e) => openField(f, ids, e.currentTarget)}>
          {FIELDS[f].label}
        </button>
      ))}
      {meId && <button type="button" className="cal-btn" onClick={() => assignToMe(ids, team, meId)}>Assign to me</button>}
      <button type="button" className="cal-btn ticket-delete-btn" onClick={() => deleteTasks(ids)}>Delete</button>
      <button type="button" className="cal-link-btn" onClick={clear}>Clear (Esc)</button>
    </div>
  )
}
