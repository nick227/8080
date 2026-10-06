import type { ReactNode } from 'react'
import './SectionHeader.css'

/** Shared desk list header: quiet title + “+ New” (+ optional Import). */
export function SectionHeader({
  title,
  titleId,
  level = 2,
  onNew,
  onImport,
  newLabel,
  children,
}: {
  title: string
  titleId?: string
  level?: 1 | 2
  onNew?: () => void
  onImport?: () => void
  newLabel?: string
  children?: ReactNode
}) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <div className="section-header">
      <Heading id={titleId}>{title}</Heading>
      {onNew && (
        <button
          type="button"
          className="section-add-btn"
          aria-label={newLabel ? `New ${newLabel}` : 'New'}
          onClick={onNew}
        >
          + New
        </button>
      )}
      {onImport && (
        <button type="button" className="section-add-btn" onClick={onImport}>
          Import
        </button>
      )}
      {children}
    </div>
  )
}
