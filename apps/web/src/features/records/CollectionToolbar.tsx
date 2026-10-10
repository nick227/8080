import type { ReactNode } from 'react'
import { CONTACT_SORTS } from '@project/shared'
import { sortLabel } from './ContactTable'
import type { CollectionLayout } from './collectionLayout'
import { STAGES, titleCase } from './labels'

type ContactFocus = 'due' | 'overdue' | 'unassigned'
type InventoryFocus = 'offered' | 'paused' | 'out' | 'low'
type StageOption = { key: string; label: string }

export function CollectionToolbar({
  kind,
  archived,
  focus,
  sort,
  dir,
  stage,
  stages = STAGES.map((key) => ({ key, label: titleCase(key) })),
  categories = [],
  category,
  tags = [],
  tagId,
  layout,
  counts,
  selectedCount,
  matchingTotal,
  onFilter,
  onFilters,
  onLayout,
  onBulk,
  contactViewPicker,
  contactColumnPicker,
  filterChips,
  part,
}: {
  /** Render one slot of the shared collection bar (redesign D9); all when omitted. */
  part?: 'filters' | 'view' | 'bulk'
  kind: 'contacts' | 'inventory'
  archived: boolean
  focus: string
  sort: string
  dir: string
  stage?: string
  stages?: StageOption[]
  categories?: string[]
  category?: string
  tags?: { id: string; name: string }[]
  tagId?: string
  layout: CollectionLayout
  counts?: {
    all: number
    due?: number
    overdue?: number
    unassigned?: number
    offered?: number
    paused?: number
    outOfStock?: number
    low?: number
    archived: number
  }
  selectedCount: number
  matchingTotal?: number
  onFilter: (key: string, value: string) => void
  onFilters: (patch: Record<string, string>) => void
  onLayout: (layout: CollectionLayout) => void
  onBulk: (action: string, extra?: Record<string, string | boolean>) => void
  contactViewPicker?: ReactNode
  contactColumnPicker?: ReactNode
  filterChips?: ReactNode
}) {
  const inventoryFocus = [
    { id: '', label: 'All items', count: counts?.all },
    { id: 'offered', label: 'Offered', count: counts?.offered },
    { id: 'paused', label: 'Paused', count: counts?.paused },
    { id: 'out', label: 'Out of stock', count: counts?.outOfStock },
    { id: 'low', label: 'Low stock', count: counts?.low },
  ] as const

  const contactFocus = [
    { id: '', label: 'All contacts', count: counts?.all },
    { id: 'due', label: 'Due today', count: counts?.due },
    { id: 'overdue', label: 'Overdue', count: counts?.overdue },
    { id: 'unassigned', label: 'Unassigned', count: counts?.unassigned },
  ] as const

  const sorts =
    kind === 'contacts'
      ? CONTACT_SORTS.map((value) => [value, sortLabel(value)])
      : [
          ['name', 'Name'],
          ['price', 'Price'],
          ['updated', 'Updated'],
          ['quantity', 'Stock'],
        ]

  const filtersPart = (
    <>
      {kind === 'contacts' && contactViewPicker}

      <select
        aria-label={kind === 'inventory' ? 'Filter inventory status' : 'Filter contact status'}
        value={archived ? 'archived' : focus}
        onChange={(e) => {
          const val = e.target.value
          if (val === 'archived') onFilters({ focus: '', status: 'archived' })
          else onFilters({ status: 'active', focus: val })
        }}
      >
        {(kind === 'inventory' ? inventoryFocus : contactFocus).map((item) => (
          <option key={item.id || 'all'} value={item.id}>
            {item.label}{typeof item.count === 'number' ? ` (${item.count})` : ''}
          </option>
        ))}
        <option value="archived">Archived{typeof counts?.archived === 'number' ? ` (${counts.archived})` : ''}</option>
      </select>

      {kind === 'inventory' && categories.length > 0 && (
        <select aria-label="Filter by category" value={category ?? ''} onChange={(e) => onFilter('category', e.target.value)}>
          <option value="">All categories</option>
          {categories.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      )}

      {kind === 'contacts' && tags.length > 0 && (
        <select aria-label="Filter by category" value={tagId ?? ''} onChange={(e) => onFilter('tag', e.target.value)}>
          <option value="">All categories</option>
          {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
      )}

      {kind === 'contacts' && (
        <select aria-label="Filter by lead stage" value={stage ?? ''} onChange={(e) => onFilter('stage', e.target.value)}>
          <option value="">All stages</option>
          {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      )}
      {filterChips}
    </>
  )

  const viewPart = (
    <>
      {/* In the table the column headers sort; the grid has no headers, so it keeps a sort control. */}
      {layout === 'grid' && (
        <>
          <select aria-label="Sort records" value={sort} onChange={(e) => onFilter('sort', e.target.value)}>
            {sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button type="button" className="record-dir-btn" aria-pressed={dir === 'desc'} onClick={() => onFilter('dir', dir === 'desc' ? 'asc' : 'desc')}>
            {dir === 'desc' ? '↓ Descending' : '↑ Ascending'}
          </button>
        </>
      )}
      {kind === 'contacts' && contactColumnPicker}
      <div className="record-layout-toggle" role="group" aria-label="Collection layout">
        <button type="button" aria-pressed={layout === 'list'} onClick={() => onLayout('list')}>
          Table
        </button>
        <button type="button" aria-pressed={layout === 'grid'} onClick={() => onLayout('grid')}>
          Grid
        </button>
      </div>
    </>
  )

  const bulkPart = selectedCount > 0 ? (
    <div className="record-bulk" role="toolbar" aria-label="Bulk actions">
      <span>
        {selectedCount} selected
        {typeof matchingTotal === 'number' ? ` of ${matchingTotal} matching` : ''}
      </span>
      {archived ? (
        <button onClick={() => onBulk('restore')}>Restore</button>
      ) : (
        <>
          <button onClick={() => onBulk('archive')}>Archive</button>
          {kind === 'contacts' ? (
            <select
              aria-label="Set stage for selected"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) onBulk('setStage', { leadStatus: e.target.value })
                e.target.value = ''
              }}
            >
              <option value="">Set stage…</option>
              {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          ) : (
            <>
              <button onClick={() => onBulk('setAvailability', { availability: true })}>Mark offered</button>
              <button onClick={() => onBulk('setAvailability', { availability: false })}>Mark paused</button>
            </>
          )}
        </>
      )}
    </div>
  ) : null

  if (part === 'filters') return <div className="record-sort-row">{filtersPart}</div>
  if (part === 'view') return <div className="record-sort-row">{viewPart}</div>
  if (part === 'bulk') return bulkPart
  return (
    <div className="record-collection-views">
      <div className="record-sort-row">{filtersPart}{viewPart}</div>
      {bulkPart}
    </div>
  )
}

export type { ContactFocus, InventoryFocus }
