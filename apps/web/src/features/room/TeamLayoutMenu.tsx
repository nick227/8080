import { useEffect, useRef, useState } from 'react'
import { GridViewIcon } from '../../components/icons'
import { VIEW_LABEL, type RoomView } from './roomViews'

export function TeamLayoutMenu({ view, onChange }: { view: RoomView; onChange: (view: RoomView) => void }) {
  const [position, setPosition] = useState({ top: 0, right: 0 })
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <div className="team-layout-control" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const items = Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }
  }}>
    <button ref={trigger} type="button" className="team-layout-trigger" title="Change layout" aria-label="Change layout" aria-haspopup="menu" aria-expanded={open} onClick={() => {
      const rect = trigger.current!.getBoundingClientRect()
      setPosition({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) })
      setOpen(!open)
    }}><GridViewIcon /></button>
    {open && <div className="team-layout-menu" style={{ position: 'fixed', ...position }} role="menu" aria-label="Layout">
      {(['grid', 'table'] as const).map(layout => <button key={layout} type="button" role="menuitemradio" aria-checked={view === layout} onClick={() => {
        onChange(layout); setOpen(false); trigger.current?.focus()
      }}><span aria-hidden>{view === layout ? '✓' : ''}</span>{VIEW_LABEL[layout]}</button>)}
    </div>}
  </div>
}
