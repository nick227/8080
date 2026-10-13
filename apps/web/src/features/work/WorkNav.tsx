import { useEffect, type ReactNode } from 'react'
import type { Desk } from './sections'
import { COLLECTIONS, isCollection } from './sections'
import './work.css'
import { useCurrentWorkspace } from '../../app/workspace'
import { NavBoardIcon, NavCalendarIcon, NavDataIcon, NavHomeIcon, NavTeamIcon } from '../../components/icons'

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
 * The workspace destinations (redesign D9/D10): Home (the company page), Data (the shared
 * collection view — returns to the last list; its title switches lists), Board, Calendar,
 * Team (the company channel / this room). Rendered once inside the unified header: a row of
 * tabs on desktop, the bottom tab bar on phones (CSS only — one model, two presentations).
 * Nothing without a company you belong to (guests, D8): the room is the whole page then.
 */
export function WorkNav({ desk, onSelect, streamLabel = 'Team', compact = false, showWork = true, showCompany = true }: {
  desk: Desk
  /** Hidden in a room listed under a company you aren't in (D8). */
  showWork?: boolean
  showCompany?: boolean
  /** Rooms: everything but Team opens the company page. */
  compact?: boolean
  onSelect: (desk: Desk) => void
  streamLabel?: string
}) {
  const { workspace } = useCurrentWorkspace()

  // Remember the last list so Data returns to it.
  useEffect(() => {
    if (!isCollection(desk)) return
    try { localStorage.setItem(LAST_LIST, desk) } catch { /* Data falls back to Tasks */ }
  }, [desk])

  if (!workspace || !showWork) return null

  const tab = (id: string, label: string, icon: ReactNode, current: boolean, go: () => void, aria?: string) => (
    <button key={id} type="button" className="work-nav-item" data-dest={id} aria-current={current ? 'page' : undefined} aria-label={aria} title={label} onClick={go}>
      {icon}
      <span className="work-nav-label">{label}</span>
    </button>
  )

  return (
    <nav className="work-nav" aria-label="Workspace" data-desk={desk} data-compact={compact || undefined}>
      {tab('home', 'Home', <NavHomeIcon />, desk === 'company', () => onSelect('company'))}
      {tab('data', 'Data', <NavDataIcon />, isCollection(desk), () => onSelect(isCollection(desk) ? desk : lastList()),
        `Data: open ${COLLECTIONS.find((c) => c.id === lastList())?.label}`)}
      {tab('board', 'Board', <NavBoardIcon />, desk === 'board', () => onSelect('board'))}
      {tab('calendar', 'Calendar', <NavCalendarIcon />, desk === 'calendar', () => onSelect('calendar'))}
      {tab('team', streamLabel, <NavTeamIcon />, desk === 'stream', () => onSelect('stream'))}
    </nav>
  )
}
