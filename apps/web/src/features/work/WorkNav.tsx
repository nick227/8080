import type { Desk } from './sections'
import { DESKS } from './sections'
import './work.css'

export function WorkNav({ desk, teamActive, onSelect }: {
  desk: Desk
  teamActive: boolean
  onSelect: (desk: Desk) => void
}) {
  return (
    <nav className="work-nav" aria-label="Workspace">
      {DESKS.map((item) => {
        const current = item.id === 'team' ? teamActive : desk === item.id
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
    </nav>
  )
}
