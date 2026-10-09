import { hourLabel } from './dates'
import { useCalendar } from './store'
import { useCanDeleteLog } from './sync'
import type { CalAccomplishment } from './types'

/** One "Log work" entry, with delete for those allowed to. */
export function WorkEntryChip({ entry }: { entry: CalAccomplishment }) {
  const remove = useCalendar((s) => s.removeAccomplishment)
  const canDelete = useCanDeleteLog()
  return (
    <div className="cal-acc-chip" data-pending={entry.pending || undefined}>
      <span className="cal-acc-icon">{entry.icon || '✨'}</span>
      {entry.taskKey && <span className="cal-acc-key">[{entry.taskKey}]</span>}
      <span className="cal-acc-title">{entry.title}</span>
      {entry.assigneeName && <span className="cal-acc-assignee">@{entry.assigneeName}</span>}
      {entry.hoursSpent != null && <span className="cal-acc-time">{entry.hoursSpent} h</span>}
      {entry.time && <time className="cal-acc-time">{hourLabel(entry.time)}</time>}
      {canDelete(entry) && (
        <button type="button" className="cal-icon-btn cal-acc-delete" aria-label={`Delete work entry ${entry.title}`} onClick={() => remove(entry.id)}>×</button>
      )}
    </div>
  )
}
