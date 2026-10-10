import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from './BoardView'
import { FIELDS, setField, sharedValue } from './actions'
import { useCalendar } from './store'
import { useTeam } from './sync'

/** The one field picker (mounted once). Every surface opens it through actions.openField. */
export function FieldPickerHost() {
  const picker = useCalendar((s) => s.picker)
  const close = useCalendar((s) => s.closePicker)
  if (!picker) return null
  return <FieldPicker key={`${picker.field}:${picker.ids.join(',')}`} onClose={close} />
}

function FieldPicker({ onClose }: { onClose: () => void }) {
  const picker = useCalendar((s) => s.picker)!
  const tasks = useCalendar((s) => s.tasks)
  const { team, meId } = useTeam()
  const def = FIELDS[picker.field]
  const chosen = tasks.filter((t) => picker.ids.includes(t.id))
  const current = sharedValue(picker.field, chosen)
  const ref = useRef<HTMLDivElement>(null)
  // Where focus goes back to when the picker closes (the card or row that opened it).
  const [returnTo] = useState(() => document.activeElement as HTMLElement | null)
  useEffect(() => () => { if (returnTo && document.contains(returnTo)) returnTo.focus() }, [returnTo])
  const [pos, setPos] = useState({ left: picker.anchor.x, top: picker.anchor.y + 4 })
  const [query, setQuery] = useState('')
  const [text, setText] = useState(def.kind === 'choice' ? '' : current ?? '')
  const options = useMemo(() => (def.options?.(team, meId) ?? []).filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())), [def, team, meId, query])
  const [at, setAt] = useState(() => Math.max(0, options.findIndex((o) => o.value === current)))

  // Keep it on screen (flip above the anchor near the bottom).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.min(Math.max(8, picker.anchor.x), window.innerWidth - r.width - 8)
    const below = picker.anchor.y + 4
    const top = below + r.height > window.innerHeight - 8 ? Math.max(8, picker.anchor.y - picker.anchor.h - r.height - 4) : below
    setPos({ left, top })
  }, [picker.anchor])

  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [onClose])

  const commit = (value: string | null) => {
    setField(picker.ids, picker.field, value, team)
    onClose()
  }

  const many = picker.ids.length > 1
  const title = many ? `${def.label} · ${picker.ids.length} tasks` : def.label

  return (
    <div
      ref={ref}
      className="cal-menu cal-picker"
      role="dialog"
      aria-label={title}
      style={{ position: 'fixed', left: pos.left, top: pos.top, right: 'auto' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
      }}
    >
      <span className="cal-menu-heading">{title}{many && current === null && def.kind === 'choice' ? ' · mixed' : ''}</span>
      {def.kind === 'choice' && (
        <>
          {(def.options?.(team, meId).length ?? 0) > 6 && (
            <input
              autoFocus
              className="cal-picker-filter"
              aria-label={`Find ${def.label.toLowerCase()}`}
              placeholder="Type to filter"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setAt(0) }}
              onKeyDown={(e) => listKeys(e)}
            />
          )}
          <ul className="cal-picker-list" role="listbox" aria-label={def.label} tabIndex={-1} onKeyDown={(e) => listKeys(e)} ref={(el) => { if (el && (def.options?.(team, meId).length ?? 0) <= 6) el.focus() }}>
            {options.map((o, i) => (
              <li key={o.value || 'none'} role="option" aria-selected={o.value === current} data-active={i === at || undefined}>
                <button type="button" tabIndex={-1} onMouseEnter={() => setAt(i)} onClick={() => commit(o.value)}>
                  {o.avatar && <Avatar name={o.avatar.name} url={o.avatar.url} />}
                  <span>{o.label}</span>
                  {o.value === current && <span className="cal-picker-check" aria-hidden="true">✓</span>}
                </button>
              </li>
            ))}
            {options.length === 0 && <li className="cal-picker-empty">No match</li>}
          </ul>
        </>
      )}
      {def.kind === 'date' && (
        <form className="cal-picker-form" onSubmit={(e) => { e.preventDefault(); commit(text || null) }}>
          <input type="date" autoFocus aria-label={def.label} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="cal-picker-actions">
            <button type="submit" className="cal-btn" data-primary="">Set</button>
            {(current || many) && <button type="button" className="cal-btn" onClick={() => commit(null)}>Clear</button>}
          </div>
        </form>
      )}
      {def.kind === 'reason' && (
        <form className="cal-picker-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) commit(text) }}>
          <label htmlFor="picker-reason" className="cal-picker-label">What {many ? 'are they' : 'is it'} waiting on?</label>
          <input id="picker-reason" autoFocus maxLength={280} value={text} placeholder="e.g. Waiting on legal sign-off" onChange={(e) => setText(e.target.value)} />
          <div className="cal-picker-actions">
            <button type="submit" className="cal-btn" data-primary="" disabled={!text.trim()}>Mark blocked</button>
            {chosen.some((t) => t.blocked) && <button type="button" className="cal-btn" onClick={() => commit(null)}>Unblock</button>}
          </div>
        </form>
      )}
    </div>
  )

  function listKeys(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setAt((i) => (options.length ? (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = options[at]
      if (o) commit(o.value)
    }
  }
}
