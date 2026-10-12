import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Column } from './table'

/**
 * Multi-select and delete, the same on every collection table (Tasks is the model):
 * checkboxes (Shift-click for a range, Space / x on a focused row), one floating bar
 * with the count, the collection's own actions, Delete and Clear (Esc), and a ✕ on each
 * row. Deletes confirm first, run per row, and say what failed.
 */

/** Selection state for one table. Ids that leave `rowIds` (deleted, filtered out) drop. */
export function useSelection(rowIds: string[]) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const present = useMemo(() => new Set(rowIds), [rowIds])
  const selected = useMemo(() => new Set([...picked].filter((id) => present.has(id))), [picked, present])
  const clear = useCallback(() => setPicked((s) => (s.size ? new Set() : s)), [])
  useEscapeClears(selected.size > 0, clear)
  return { selected, ids: [...selected], set: setPicked, clear }
}

/** Esc clears a selection (not while typing in a field or inside a dialog). */
export function useEscapeClears(active: boolean, clear: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"], [role="dialog"]')) return
      clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, clear])
}

/** The floating bar for the selection; `children` are the collection's own bulk actions. */
export function SelectionBar({ count, onClear, onDelete, deleteLabel = 'Delete', busy, children }: {
  count: number
  onClear: () => void
  onDelete?: () => void
  deleteLabel?: string
  busy?: boolean
  children?: ReactNode
}) {
  if (!count) return null
  return (
    <div className="collection-bulkbar" role="toolbar" aria-label={`${count} selected`} aria-busy={busy || undefined}>
      <strong>{count} selected</strong>
      {children}
      {onDelete && <button type="button" className="collection-bulk-btn collection-bulk-delete" disabled={busy} onClick={onDelete}>{busy ? 'Working…' : deleteLabel}</button>}
      <button type="button" className="collection-bulk-clear" onClick={onClear}>Clear (Esc)</button>
    </div>
  )
}

/** A trailing column with a ✕ per row. `can` hides it on rows the viewer can't delete. */
export function deleteColumn<T>({ name, onDelete, can, verb = 'Delete' }: {
  name: (row: T) => string
  onDelete: (row: T) => void
  can?: (row: T) => boolean
  verb?: string
}): Column<T> {
  return {
    id: 'delete', header: '', width: '3rem', hideable: false, align: 'end', className: 'collection-delete-cell',
    cell: (row) => (can && !can(row) ? null : (
      <button type="button" className="collection-row-action collection-row-delete" aria-label={`${verb} ${name(row)}`} title={verb}
        onClick={(e) => { e.stopPropagation(); onDelete(row) }}>
        ✕
      </button>
    )),
  }
}

type Noun = { one: string; many: string }
const plural = (n: number, noun: Noun) => `${n} ${n === 1 ? noun.one : noun.many}`
const reason = (error: unknown) => {
  const e = error as { status?: number; message?: string } | null
  if (e?.status === 403) return 'you don’t have permission'
  if (e?.status === 404) return 'already gone'
  return e?.message || 'something went wrong'
}

type Options = {
  noun: Noun
  remove: (id: string) => Promise<unknown>
  verb?: string
  past?: string
  /** A second sentence in the confirm, e.g. "This can't be undone." */
  warning?: string
  done?: (ids: string[]) => void
}
export type BulkResult = { text: string; failed: boolean } | null

/**
 * Confirm, then delete each id (a few at a time) through the collection's own delete.
 * `done` gets the ids that went; `result` says how many and why any didn't. `run` is
 * stable, so tables can build their columns once.
 */
export function useBulkDelete(options: Options) {
  const latest = useRef(options)
  latest.current = options
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BulkResult>(null)
  const run = useCallback(async (ids: string[], name?: string) => {
    const { noun, remove, verb = 'Delete', past = 'Deleted', warning, done } = latest.current
    if (!ids.length || running.current) return
    const what = ids.length === 1 && name ? `“${name}”` : plural(ids.length, noun)
    if (!window.confirm(`${verb} ${what}?${warning ? ` ${warning}` : ''}`)) return
    running.current = true
    setBusy(true)
    setResult(null)
    const ok: string[] = []
    const failed: string[] = []
    const queue = [...ids]
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try { await remove(id); ok.push(id) } catch (error) { failed.push(reason(error)) }
      }
    }))
    running.current = false
    setBusy(false)
    if (ok.length) done?.(ok)
    if (failed.length) {
      const why = [...new Set(failed)].join('; ')
      setResult({ failed: true, text: `${ok.length ? `${past} ${plural(ok.length, noun)}. ` : ''}${plural(failed.length, noun)} couldn’t be ${past.toLowerCase()}: ${why}.` })
    } else if (ids.length > 1) setResult({ failed: false, text: `${past} ${plural(ok.length, noun)}.` })
  }, [])
  const dismiss = useCallback(() => setResult(null), [])
  return { run, busy, result, dismiss }
}

/** The bulk-delete result line under the toolbar (an alert when anything failed). */
export function BulkMessage({ result, onDismiss }: { result: BulkResult; onDismiss: () => void }) {
  if (!result) return null
  return (
    <p className="collection-note collection-bulk-message" role={result.failed ? 'alert' : 'status'} data-failed={result.failed || undefined}>
      {result.text} <button type="button" className="cal-link-btn" onClick={onDismiss}>Dismiss</button>
    </p>
  )
}
