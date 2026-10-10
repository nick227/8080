import { useEffect, useRef, useState } from 'react'
import { useDeskSelect } from '../records/navigation'
import { COLLECTIONS, type Desk } from './sections'

/**
 * The shared collection view's title (redesign D9): the current collection's name as a
 * menu button; choosing another switches collection, keeping each one's own filters.
 */
export function CollectionSwitcher({ current, level = 1, id }: { current: Desk; level?: 1 | 2; id?: string }) {
  const select = useDeskSelect()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLUListElement>(null)
  const label = COLLECTIONS.find((c) => c.id === current)?.label ?? 'Lists'
  const Heading = level === 1 ? 'h1' : 'h2'

  useEffect(() => {
    if (!open) return
    setActive(Math.max(0, COLLECTIONS.findIndex((c) => c.id === current)))
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open, current])
  useEffect(() => {
    if (open) (menu.current?.children[active] as HTMLElement | undefined)?.focus()
  }, [open, active])

  const choose = (desk: Desk) => {
    setOpen(false)
    button.current?.focus()
    if (desk !== current) select(desk)
  }

  return (
    <div className="collection-switcher">
      <Heading id={id} className="collection-switcher-title">
        <button
          ref={button}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) } }}
        >
          {label}<span className="collection-switcher-caret" aria-hidden>▾</span>
        </button>
      </Heading>
      {open && (
        <ul
          ref={menu}
          role="menu"
          aria-label="Lists"
          className="collection-switcher-menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); button.current?.focus() }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % COLLECTIONS.length) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + COLLECTIONS.length) % COLLECTIONS.length) }
            else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
            else if (e.key === 'End') { e.preventDefault(); setActive(COLLECTIONS.length - 1) }
            else if (e.key === 'Tab') setOpen(false)
          }}
        >
          {COLLECTIONS.map((c, i) => (
            <li
              key={c.id}
              role="menuitemradio"
              aria-checked={c.id === current}
              tabIndex={i === active ? 0 : -1}
              onClick={() => choose(c.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(c.id) } }}
              onMouseMove={() => setActive(i)}
            >
              {c.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
