import type { ReactNode } from 'react'
import { CollectionSwitcher } from './CollectionSwitcher'
import type { Desk } from './sections'
import './SectionHeader.css'

/** Shared desk list header: quiet title + “+ New” (+ optional Import). */
export function SectionHeader({
  title,
  titleId,
  level = 2,
  onNew,
  onImport,
  newLabel,
  collection,
  count,
  children,
}: {
  title: string
  /** A tabular collection: the title becomes the shared list switcher (redesign D9). */
  collection?: Desk
  /** Shown beside the title, e.g. the number of rows. */
  count?: number
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
      {collection ? <CollectionSwitcher current={collection} level={level} id={titleId} /> : <Heading id={titleId}>{title}</Heading>}
      {count != null && <span className="section-count">{count}</span>}
      {onNew && (
        <button
          type="button"
          className="section-add-btn"
          aria-label={newLabel ? `New ${newLabel}` : 'New'}
          onClick={onNew}
        >
          {collection && newLabel ? `+ New ${newLabel}` : '+ New'}
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
