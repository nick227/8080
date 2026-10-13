import React, { useEffect, useState, type ReactNode } from 'react'
import type { Desk } from './sections'
import { COLLECTIONS, DESKS, isCollection } from './sections'
import './work.css'
import { ActiveUsersWidget } from '../documents/ActiveUsersWidget'
import { useCurrentWorkspace } from '../../app/workspace'
import { useCompanyProfile } from '../company/useCompanyProfile'

const LAST_LIST = '8080.nav.list'

function lastList(): Desk {
  try {
    const saved = localStorage.getItem(LAST_LIST) as Desk | null
    if (saved === 'team') return 'members'
    if (saved && isCollection(saved)) return saved
  } catch { /* Tasks */ }
  return 'tasks'
}

/**
 * The work nav (redesign D9): the company, Lists (the shared collection view — tasks,
 * contacts, inventory, team, documents, automations — switched in its header; returns
 * to the last list), Board, Calendar, Stream. Without a company (guests, D8) only Stream.
 */
export function WorkNav({ desk, onSelect, layoutControl, streamLabel = 'Team', compact = false, showCompany = true, showWork = true }: {
  desk: Desk
  /** The company mark: in a room, only when the room is listed in that company. */
  showCompany?: boolean
  /** Lists, Board, Calendar: hidden in a room listed under a company you aren't in (D8). */
  showWork?: boolean
  /** Rooms: everything but Stream opens the company page. */
  compact?: boolean
  layoutControl?: ReactNode
  onSelect: (desk: Desk) => void
  streamLabel?: string
}) {
  const { workspace } = useCurrentWorkspace()
  const { profile } = useCompanyProfile(workspace?.id)
  const [imgError, setImgError] = useState(false)
  const logoUrl = profile?.logoUrl

  useEffect(() => {
    setImgError(false)
  }, [logoUrl])

  // Remember the last list so Lists returns to it.
  useEffect(() => {
    if (!isCollection(desk)) return
    try { localStorage.setItem(LAST_LIST, desk) } catch { /* Lists falls back to Tasks */ }
  }, [desk])

  const item = (id: Desk, label = DESKS.find((d) => d.id === id)?.label ?? id) => (
    <button key={id} type="button" className="work-nav-item" aria-current={desk === id ? 'page' : undefined} onClick={() => onSelect(id)}>
      {label}
    </button>
  )

  return (
    <header className="work-nav" aria-label="Workspace" data-desk={desk} data-compact={compact || undefined}>
      {workspace && showWork && (
        <>
          {showCompany && <button
            type="button"
            className="work-nav-company"
            aria-current={desk === 'company' ? 'page' : undefined}
            aria-label={`${workspace.name}: company overview`}
            onClick={() => onSelect('company')}
          >
            <span className={`work-nav-company-mark${logoUrl && !imgError ? ' has-image' : ''}`} aria-hidden>
              {logoUrl && !imgError ? (
                <img src={logoUrl} alt="" onError={() => setImgError(true)} />
              ) : (
                workspace.name.trim().charAt(0).toUpperCase() || '·'
              )}
            </span>
            <span className="work-nav-company-name">{workspace.name}</span>
          </button>}
          <button type="button" className="work-nav-item work-nav-home" aria-current={desk === 'company' ? 'page' : undefined} onClick={() => onSelect('company')}>
            Home
          </button>
          <button
            type="button"
            className="work-nav-item work-nav-data"
            aria-current={isCollection(desk) ? 'page' : undefined}
            aria-label={`Lists: open ${COLLECTIONS.find((c) => c.id === lastList())?.label}`}
            onClick={() => onSelect(isCollection(desk) ? desk : lastList())}
          >
            Data
          </button>
          {item('board')}
          {item('calendar')}
        </>
      )}
      <button type="button" className="work-nav-item work-nav-stream" aria-current={desk === 'stream' ? 'page' : undefined} onClick={() => onSelect('stream')}>
        {streamLabel}
      </button>

      <div className="work-nav-search">
        {layoutControl}
        <ActiveUsersWidget />
      </div>
    </header>
  )
}
