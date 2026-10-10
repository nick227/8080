import type { ReactNode } from 'react'
import { SearchIcon } from '../../components/icons'
import { CollectionSwitcher } from '../work/CollectionSwitcher'
import { COLLECTIONS, type Desk } from '../work/sections'
import './collections.css'

/**
 * The one frame every tabular collection uses (redesign D9): a header with the list
 * switcher, count and "+ New …"; a toolbar with search on the left, the collection's own
 * filters, and view controls (columns, layout, export) on the right; then the body.
 * Domains fill the slots; the placement never changes between collections.
 */
type HeadProps = {
  collection: Desk
  count?: number
  onNew?: () => void
  /** Header actions beside "+ New" (Import, Log work…). */
  actions?: ReactNode
}
type BarProps = {
  collection: Desk
  search?: { value: string; onChange: (value: string) => void; placeholder?: string }
  filters?: ReactNode
  view?: ReactNode
}

/** The list switcher, count and "+ New …" (one header for every collection). */
export function CollectionHeader({ collection, count, onNew, actions }: HeadProps) {
  const meta = COLLECTIONS.find((c) => c.id === collection)
  return (
    <header className="collection-head">
      <CollectionSwitcher current={collection} id={`collection-${collection}-title`} />
      {count != null && <span className="collection-count" aria-label={`${count} ${count === 1 ? meta?.singular : meta?.label.toLowerCase()}`}>{count}</span>}
      <div className="collection-actions">
        {actions}
        {onNew && <button type="button" className="collection-new" onClick={onNew}>+ New {meta?.singular}</button>}
      </div>
    </header>
  )
}

/** Search on the left, the collection's filters, then view controls on the right. */
export function CollectionBar({ collection, search, filters, view }: BarProps) {
  const meta = COLLECTIONS.find((c) => c.id === collection)
  if (!search && !filters && !view) return null
  return (
    <div className="collection-bar" role="toolbar" aria-label={`${meta?.label} controls`}>
      {search && (
        <label className="collection-search">
          <SearchIcon />
          <input
            type="search"
            value={search.value}
            placeholder={search.placeholder ?? `Search ${meta?.label.toLowerCase()}…`}
            aria-label={`Search ${meta?.label.toLowerCase()}`}
            onChange={(e) => search.onChange(e.target.value)}
          />
        </label>
      )}
      {filters && <div className="collection-filters">{filters}</div>}
      {view && <div className="collection-view-controls">{view}</div>}
    </div>
  )
}

export function CollectionView({ collection, count, onNew, actions, search, filters, view, notice, children }: HeadProps & BarProps & {
  /** Between the toolbar and the table: selection bars, banners. */
  notice?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="collection" aria-labelledby={`collection-${collection}-title`}>
      <CollectionHeader collection={collection} count={count} onNew={onNew} actions={actions} />
      <CollectionBar collection={collection} search={search} filters={filters} view={view} />
      {notice}
      <div className="collection-body">{children}</div>
    </section>
  )
}
