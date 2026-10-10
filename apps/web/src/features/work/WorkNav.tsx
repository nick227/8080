import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Desk } from './sections'
import { DESKS } from './sections'
import './work.css'
import { ActiveUsersWidget } from '../documents/ActiveUsersWidget'
import { SearchIcon } from '../../components/icons'

const SEARCHABLE: Desk[] = ['contacts', 'inventory']

export function WorkNav({ desk, teamActive, onSelect, layoutControl }: {
  desk: Desk
  layoutControl?: ReactNode
  teamActive: boolean
  onSelect: (desk: Desk) => void
}) {
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

  return (
    <nav className="work-nav" aria-label="Workspace" data-desk={desk}>
      {DESKS.map((item) => {
        const current = desk === item.id
        return (
          <button
            key={item.id}
            type="button"
            className="work-nav-item"
            aria-current={current ? 'page' : undefined}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        )
      })}
      
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