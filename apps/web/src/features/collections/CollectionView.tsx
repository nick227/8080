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
  collection?: Desk
  title?: string
  count?: number
  onNew?: () => void
  onImport?: () => void
  /** Header actions beside "+ New" / "Import" (view switches, icon buttons, etc.). */
  actions?: ReactNode
}
type BarProps = {
  collection: Desk
  search?: { value: string; onChange: (value: string) => void; placeholder?: string }
  filters?: ReactNode
  view?: ReactNode
}

/** The list switcher, count, "+ New …" and "Import" (one header for every collection). */
export function CollectionHeader({ collection, title, count, onNew, onImport, actions }: HeadProps) {
  const meta = collection ? COLLECTIONS.find((c) => c.id === collection) : undefined
  const displayTitle = title ?? meta?.label ?? 'Collection'
  const titleId = `collection-${collection ?? (title ?? 'header').toLowerCase().replace(/\s+/g, '-')}-title`
  return (
    <header className="collection-head">
      {collection ? (
        <CollectionSwitcher current={collection} id={titleId} />
      ) : (
        <h1 className="collection-title" id={titleId}>{displayTitle}</h1>
      )}
      {count != null && <span className="collection-count" aria-label={`${count} ${count === 1 ? (meta?.singular ?? 'task') : (meta?.label ?? 'tasks').toLowerCase()}`}>{count}</span>}
      {onNew && (
        <button
          type="button"
          className="section-add-btn"
          aria-label={meta?.newLabel ?? `New ${meta?.singular ?? 'task'}`}
          onClick={onNew}
        >
          + {meta?.newLabel ?? `New ${meta?.singular ?? 'task'}`}
        </button>
      )}
      {onImport && (
        <button
          type="button"
          className="section-add-btn"
          onClick={onImport}
        >
          Import
        </button>
      )}
      {actions && <div className="collection-actions">{actions}</div>}
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

export function CollectionView({ collection, count, onNew, onImport, actions, subtitle, search, filters, view, notice, children }: HeadProps & BarProps & {
  /** One line under the title saying what the list is for. */
  subtitle?: ReactNode
  /** Between the toolbar and the table: selection bars, banners. */
  notice?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="collection" aria-labelledby={`collection-${collection}-title`}>
      <CollectionHeader collection={collection} count={count} onNew={onNew} onImport={onImport} actions={actions} />
      {subtitle && <p className="collection-subtitle">{subtitle}</p>}
      <CollectionBar collection={collection} search={search} filters={filters} view={view} />
      {notice}
      <div className="collection-body">{children}</div>
    </section>
  )
}
