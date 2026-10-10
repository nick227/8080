import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Desk } from './sections'
import { DESKS, NAV_GROUPS } from './sections'
import './work.css'
import { ActiveUsersWidget } from '../documents/ActiveUsersWidget'
import { SearchIcon } from '../../components/icons'
import { useCurrentWorkspace } from '../../app/workspace'

const SEARCHABLE: Desk[] = ['contacts', 'inventory']
const lastKey = (group: string) => `8080.nav.${group}`

function lastDesk(group: (typeof NAV_GROUPS)[number]): Desk {
  try {
    const saved = localStorage.getItem(lastKey(group.id)) as Desk | null
    if (saved && group.desks.includes(saved)) return saved
  } catch { /* first desk */ }
  return group.desks[0]
}

/**
 * The work nav: company identity, then Work and Manage as labelled groups (each label
 * returns to that group's last desk), then Stream. Every desk stays one click away on
 * wide screens; narrow screens show only the active group's desks. Without a company
 * (guests, D8) only Stream is offered.
 */
export function WorkNav({ desk, onSelect, layoutControl, streamLabel = 'Stream', compact = false }: {
  desk: Desk
  /** Rooms: Work and Manage open the company page, so only their labels are shown. */
  compact?: boolean
  layoutControl?: ReactNode
  onSelect: (desk: Desk) => void
  streamLabel?: string
}) {
  const { workspace } = useCurrentWorkspace()
  const searchRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const label = DESKS.find((item) => item.id === desk)?.label.toLowerCase() || 'site'
  const searchable = SEARCHABLE.includes(desk)
  const q = searchable ? (new URLSearchParams(location.search).get('q') ?? '') : ''
  const [value, setValue] = useState(q)
  useEffect(() => setValue(q), [q, desk])
  useEffect(() => {
    if (!searchable || value === q) return
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(location.search)
      if (desk === 'contacts') { next.delete('record'); next.delete('preview'); next.delete('previewKind') }
      const trimmed = value.trim()
      if (trimmed) next.set('q', trimmed)
      else next.delete('q')
      navigate({ search: next.toString() }, { replace: true })
    }, 200)
    return () => window.clearTimeout(timer)
  }, [value, q, searchable, location.search, navigate, desk])
  // Remember each group's last desk so its label returns there.
  useEffect(() => {
    const group = NAV_GROUPS.find((g) => g.desks.includes(desk))
    if (!group) return
    try { localStorage.setItem(lastKey(group.id), desk) } catch { /* label falls back to the first desk */ }
  }, [desk])

  const item = (id: Desk) => {
    const entry = DESKS.find((d) => d.id === id)
    if (!entry) return null
    return (
      <button key={id} type="button" className="work-nav-item" aria-current={desk === id ? 'page' : undefined} onClick={() => onSelect(id)}>
        {entry.label}
      </button>
    )
  }

  return (
    <nav className="work-nav" aria-label="Workspace" data-desk={desk} data-compact={compact || undefined}>
      {workspace && (
        <>
          <button
            type="button"
            className="work-nav-company"
            aria-current={desk === 'company' ? 'page' : undefined}
            aria-label={`${workspace.name}: company overview`}
            onClick={() => onSelect('company')}
          >
            <span className="work-nav-company-mark" aria-hidden>{workspace.name.trim().charAt(0).toUpperCase() || '·'}</span>
            <span className="work-nav-company-name">{workspace.name}</span>
          </button>
          {NAV_GROUPS.map((group) => {
            const active = group.desks.includes(desk)
            return (
              <div key={group.id} className="work-nav-group" role="group" aria-label={group.label} data-active={active || undefined}>
                <button type="button" className="work-nav-group-label" aria-label={`${group.label}: open ${DESKS.find((d) => d.id === lastDesk(group))?.label}`} onClick={() => onSelect(lastDesk(group))}>
                  {group.label}
                </button>
                {group.desks.map(item)}
              </div>
            )
          })}
        </>
      )}
      <button type="button" className="work-nav-item work-nav-stream" aria-current={desk === 'stream' ? 'page' : undefined} onClick={() => onSelect('stream')}>
        {streamLabel}
      </button>

      <div className="work-nav-search">
        {layoutControl}
        <ActiveUsersWidget />
        {/* Only desks that filter by it get a search box; real global search comes with the shell. */}
        {searchable && (
          <div className="work-search">
            <input
              ref={searchRef}
              type="search"
              placeholder={desk === 'contacts' ? 'Search contacts, companies, interests…' : `Search ${label}...`}
              aria-label={`Search ${label}`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <button type="button" className="work-search-btn" aria-label="Search" onClick={() => searchRef.current?.focus()}>
              <SearchIcon />
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
