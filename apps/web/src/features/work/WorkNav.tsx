import type { WorkSection } from './sections'
import { WORK_SECTIONS } from './sections'
import './work.css'

export function WorkNav({ section, teamActive, onSelect }: {
  section: WorkSection
  teamActive: boolean
  onSelect: (section: WorkSection) => void
}) {
  return (
    <nav className="work-nav" aria-label="Workspace">
      {WORK_SECTIONS.map((item) => {
        const current = item.id === 'team' ? teamActive : section === item.id
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
