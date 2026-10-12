import { useMemo } from 'react'
import { FIELDS, FIELD_ORDER, assignToMe, deleteTasks, openField } from './actions'
import { useCalendar } from './store'
import { useTeam } from './sync'
import { SelectionBar } from '../collections/selection'

/** Actions for the selection, through the same pickers as one card. */
export function BulkBar() {
  const selection = useCalendar((s) => s.selection)
  const tasks = useCalendar((s) => s.tasks)
  const clear = useCalendar((s) => s.clearSelection)
  const { team, meId } = useTeam()
  const taskSet = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])
  const ids = useMemo(() => selection.filter((id) => taskSet.has(id)), [selection, taskSet])
  return (
    <SelectionBar count={ids.length} onClear={clear} onDelete={() => deleteTasks(ids)}>
      {FIELD_ORDER.map((f) => (
        <button key={f} type="button" className="collection-bulk-btn" onClick={(e) => openField(f, ids, e.currentTarget)}>
          {FIELDS[f].label}
        </button>
      ))}
      {meId && <button type="button" className="collection-bulk-btn" onClick={() => assignToMe(ids, team, meId)}>Assign to me</button>}
    </SelectionBar>
  )
}
