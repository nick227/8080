import type { LeadStatus } from '@project/sdk'
import { STAGES, titleCase } from './labels'

type ContactFocus = 'due' | 'overdue' | 'unassigned'
type InventoryFocus = 'offered' | 'paused' | 'out' | 'low'

export function CollectionToolbar({
  kind,
  archived,
  focus,
  sort,
  dir,
  stage,
  counts,
  selectedCount,
  matchingTotal,
  onFilter,
  onFilters,
  onBulk,
}: {
  kind: 'contacts' | 'inventory'
  archived: boolean
  focus: string
  sort: string
  dir: string
  stage?: LeadStatus
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
  onBulk: (action: string, extra?: Record<string, string | boolean>) => void
}) {
  const contactFocus = [
    { id: '', label: 'All', count: counts?.all },
    { id: 'due', label: 'Follow-up due', count: counts?.due },
    { id: 'overdue', label: 'Overdue', count: counts?.overdue },
    { id: 'unassigned', label: 'Unassigned', count: counts?.unassigned },
  ] as const
  const inventoryFocus = [
    { id: '', label: 'All', count: counts?.all },
    { id: 'offered', label: 'Offered', count: counts?.offered },
    { id: 'paused', label: 'Paused', count: counts?.paused },
    { id: 'out', label: 'Out of stock', count: counts?.outOfStock },
    { id: 'low', label: 'Low stock', count: counts?.low },
  ] as const
  const focuses = kind === 'contacts' ? contactFocus : inventoryFocus
  const sorts =
    kind === 'contacts'
      ? [
          ['name', 'Name'],
          ['followUp', 'Follow-up'],
          ['updated', 'Updated'],
          ['activity', 'Activity'],
        ]
      : [
          ['name', 'Name'],
          ['price', 'Price'],
          ['updated', 'Updated'],
          ['quantity', 'Stock'],
        ]
  return (
    <div className="record-collection-views">
      <div className="record-focus-row">
        {focuses.map((item) => (
          <button
            key={item.id || 'all'}
            aria-pressed={!archived && focus === item.id}
            disabled={archived && !!item.id}
            onClick={() => onFilters({ status: 'active', focus: item.id })}
          >
            {item.label}
            {typeof item.count === 'number' ? ` ${item.count}` : ''}
          </button>
        ))}
        <button aria-pressed={archived} onClick={() => onFilters({ focus: '', status: 'archived' })}>
          Archived{typeof counts?.archived === 'number' ? ` ${counts.archived}` : ''}
        </button>
      </div>
      <div className="record-sort-row">
        {kind === 'contacts' && (
          <select
            aria-label="Filter by lead stage"
            value={stage ?? ''}
            onChange={(e) => onFilter('stage', e.target.value)}
          >
            <option value="">All stages</option>
            {STAGES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Sort records" value={sort} onChange={(e) => onFilter('sort', e.target.value)}>
          {sorts.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button aria-pressed={dir === 'desc'} onClick={() => onFilter('dir', dir === 'desc' ? 'asc' : 'desc')}>
          {dir === 'desc' ? 'Descending' : 'Ascending'}
        </button>
      </div>
      {selectedCount > 0 && (
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
                  {STAGES.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
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
      )}
    </div>
  )
}

export type { ContactFocus, InventoryFocus }
