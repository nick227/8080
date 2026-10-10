import { useEffect, useMemo, useRef, useState } from 'react'
import { useUpdateTaskStatuses } from '@project/sdk'
import { STATUS_CATEGORIES, workflowProblem, type StatusCategory } from '@project/shared'
import { useCalendar } from './store'

// Admins shape the workflow: the board's columns are these statuses, in order.
// Keys never change; a status taken off the board is retired (kept for history),
// and its tasks move to a status chosen here.

type Row = { key?: string; label: string; category: StatusCategory; handoff: boolean; archived: boolean; tmp: string }

export function WorkflowEditor({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const statuses = useCalendar((s) => s.statuses)
  const tasks = useCalendar((s) => s.tasks)
  const update = useUpdateTaskStatuses(workspaceId)
  const [rows, setRows] = useState<Row[]>(() =>
    [...statuses].sort((a, b) => a.position - b.position).map((s) => ({ key: s.key, label: s.label, category: s.category, handoff: s.handoff, archived: s.archived, tmp: s.key })),
  )
  const [reassign, setReassign] = useState<Record<string, string>>({})
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', esc, true)
    return () => document.removeEventListener('keydown', esc, true)
  }, [onClose])

  const count = useMemo(() => {
    const out: Record<string, number> = {}
    for (const t of tasks) out[t.status] = (out[t.status] ?? 0) + 1
    return out
  }, [tasks])

  const active = rows.filter((r) => !r.archived)
  const retired = rows.filter((r) => r.archived)
  const wasActive = new Set(statuses.filter((s) => !s.archived).map((s) => s.key))
  // Statuses leaving the board now that still hold tasks: they need a destination.
  const leaving = retired.filter((r) => r.key && wasActive.has(r.key) && (count[r.key] ?? 0) > 0)
  const destinations = active.filter((r) => r.key) // only saved statuses can receive tasks
  const problem = workflowProblem(rows.map((r) => ({ ...r, key: r.key ?? r.tmp })))
    ?? (leaving.some((r) => !reassign[r.key!] || !destinations.some((d) => d.key === reassign[r.key!])) ? 'Choose where the tasks of each retired status go' : null)

  const set = (tmp: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.tmp === tmp ? { ...r, ...patch } : r)))
  const move = (tmp: string, step: -1 | 1) => setRows((rs) => {
    const list = rs.filter((r) => !r.archived)
    const at = list.findIndex((r) => r.tmp === tmp)
    const to = at + step
    if (to < 0 || to >= list.length) return rs
    ;[list[at], list[to]] = [list[to]!, list[at]!]
    return [...list, ...rs.filter((r) => r.archived)]
  })

  const save = () => {
    if (problem) return
    update.mutate(
      {
        statuses: [...active, ...retired].map((r) => ({ ...(r.key ? { key: r.key } : {}), label: r.label.trim(), category: r.category, handoff: r.handoff, archived: r.archived })),
        reassign: Object.fromEntries(leaving.map((r) => [r.key!, reassign[r.key!]!])),
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div className="cal-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cal-dialog cal-workflow" role="dialog" aria-modal="true" aria-labelledby="workflow-title" ref={ref}>
        <div className="cal-dialog-header">
          <h2 id="workflow-title">Board columns</h2>
          <p className="cal-dialog-sub">Each column is a status. Its category decides what counts as started and done (resolved dates, urgency, reports). Handoff tells the task's creator and assignee when a task arrives.</p>
        </div>
        <ol className="cal-workflow-list">
          {active.map((r, i) => (
            <li key={r.tmp}>
              <div className="cal-workflow-move">
                <button type="button" className="cal-icon-btn" aria-label={`Move ${r.label || 'status'} left`} disabled={i === 0} onClick={() => move(r.tmp, -1)}>↑</button>
                <button type="button" className="cal-icon-btn" aria-label={`Move ${r.label || 'status'} right`} disabled={i === active.length - 1} onClick={() => move(r.tmp, 1)}>↓</button>
              </div>
              <input aria-label={`Name of column ${i + 1}`} maxLength={40} value={r.label} onChange={(e) => set(r.tmp, { label: e.target.value })} />
              <select aria-label={`Category of ${r.label || 'status'}`} value={r.category} onChange={(e) => set(r.tmp, { category: e.target.value as StatusCategory })}>
                {STATUS_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <label className="cal-workflow-handoff">
                <input type="checkbox" checked={r.handoff} onChange={(e) => set(r.tmp, { handoff: e.target.checked })} /> Handoff
              </label>
              <span className="cal-workflow-count">{r.key ? `${count[r.key] ?? 0} tasks` : 'new'}</span>
              <button type="button" className="cal-link-btn" aria-label={`Retire ${r.label || 'status'}`} onClick={() => (r.key ? set(r.tmp, { archived: true }) : setRows((rs) => rs.filter((x) => x.tmp !== r.tmp)))}>
                {r.key ? 'Retire' : 'Remove'}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="cal-btn cal-workflow-add" disabled={rows.length >= 12}
          onClick={() => setRows((rs) => [...rs.filter((r) => !r.archived), { label: '', category: 'doing', handoff: false, archived: false, tmp: crypto.randomUUID() }, ...rs.filter((r) => r.archived)])}>
          + Add column
        </button>

        {leaving.length > 0 && (
          <div className="cal-workflow-reassign">
            <h3>Move their tasks</h3>
            {leaving.map((r) => (
              <label key={r.tmp}>
                <span>{count[r.key!]} in “{statuses.find((s) => s.key === r.key)?.label ?? r.label}” go to</span>
                <select aria-label={`Move tasks from ${r.label} to`} value={reassign[r.key!] ?? ''} onChange={(e) => setReassign((m) => ({ ...m, [r.key!]: e.target.value }))}>
                  <option value="" disabled>Choose a column</option>
                  {destinations.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}

        {retired.length > 0 && (
          <div className="cal-workflow-retired">
            <h3>Retired</h3>
            {retired.map((r) => (
              <span key={r.tmp}>
                {r.label} <button type="button" className="cal-link-btn" onClick={() => set(r.tmp, { archived: false })}>Bring back</button>
              </span>
            ))}
          </div>
        )}

        {(problem || update.isError) && <p className="cal-workflow-problem" role="alert">{update.isError ? (update.error as Error).message : problem}</p>}
        <div className="cal-actions">
          <button type="button" className="cal-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="cal-btn" data-primary="" disabled={!!problem || update.isPending} onClick={save}>{update.isPending ? 'Saving…' : 'Save columns'}</button>
        </div>
      </div>
    </div>
  )
}
