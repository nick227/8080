import { useEffect, useRef, useState } from 'react'
import type { TableState } from './table'

/** Show/hide a collection table's columns (remembered per list in this browser). */
export function ColumnsMenu<T>({ state }: { state: TableState<T> }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc) }
  }, [open])
  const hideable = state.columns.filter((c, i) => i > 0 && c.hideable !== false)
  if (!hideable.length) return null
  return (
    <div className="collection-menu" ref={root}>
      <button type="button" className="collection-control" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        Columns <span aria-hidden>▾</span>
      </button>
      {open && (
        <fieldset className="collection-menu-panel">
          <legend className="collection-menu-legend">Show columns</legend>
          {hideable.map((c) => (
            <label key={c.id}>
              <input type="checkbox" checked={!state.hidden.has(c.id)} onChange={() => state.toggle(c.id)} />
              {c.header}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}

/** A row of mutually exclusive filter chips (e.g. All / Active / Paused), with counts. */
export function FilterChips<K extends string>({ label, value, options, onChange }: {
  label: string
  value: K
  options: { id: K; label: string; count?: number }[]
  onChange: (id: K) => void
}) {
  return (
    <div className="collection-chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}{o.count != null && <span className="collection-chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
