import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

// Closes an open popover on an outside pointer or Escape.
export function useDismiss(open: boolean, close: () => void, root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, root])
}

export function DocMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, root)

  return (
    <div className="docs-menu" ref={root}>
      <button
        type="button"
        className="docs-menu-btn"
        aria-label="Document menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span />
      </button>
      {open && (
        <div className="docs-menu-panel" role="menu">
          <button type="button" role="menuitem" className="text-danger" onClick={onDelete}>Delete</button>
        </div>
      )}
    </div>
  )
}
