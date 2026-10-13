import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * A toolbar's secondary controls (filters, view options). Desktop: they lay out inline as
 * if this wrapper weren't there. Phones (< 720px): a "Filters" button opens them in a
 * bottom sheet, so the page starts with its content instead of rows of selects (D10).
 */
export function FilterSheet({ active = 0, label = 'Filters', children }: {
  /** How many filters are on (shown on the button). */
  active?: number
  label?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const toggle = useRef<HTMLButtonElement>(null)
  const done = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    done.current?.focus()
    const esc = (e: KeyboardEvent) => {
      // Let an open menu inside the sheet close first.
      if (e.key !== 'Escape' || e.defaultPrevented) return
      setOpen(false)
      toggle.current?.focus()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])

  const close = () => { setOpen(false); toggle.current?.focus() }

  return (
    <>
      <button ref={toggle} type="button" className="filter-sheet-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden><path d="M2.5 4h11M4.5 8h7M6.5 12h3" /></svg>
        {label}
        {active > 0 && <span className="filter-sheet-count">{active}</span>}
      </button>
      <div className="filter-sheet" id={id} data-open={open || undefined} role="group" aria-label={label}>
        <div className="filter-sheet-head">
          <span>{label}</span>
          <button ref={done} type="button" onClick={close}>Done</button>
        </div>
        <div className="filter-sheet-body">{children}</div>
      </div>
      {open && <button type="button" className="filter-sheet-scrim" aria-label={`Close ${label.toLowerCase()}`} onClick={close} />}
    </>
  )
}
