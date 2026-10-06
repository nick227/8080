import { useInventoryStockMovements, type StockMovement } from '@project/sdk'
import { dateLabel } from './labels'

export function StockHistory({ workspaceId, inventoryId }: { workspaceId: string; inventoryId: string }) {
  const query = useInventoryStockMovements(workspaceId, inventoryId)
  const rows = query.data?.pages.flatMap((page) => page.data) ?? []
  if (query.isLoading) return <p className="record-muted">Loading stock history…</p>
  if (query.isError) return <p className="record-error">Could not load stock history.</p>
  if (!rows.length) return <p className="record-muted">No stock changes recorded yet.</p>
  return (
    <section className="record-stock-history">
      <h2>Stock history</h2>
      <ol>
        {rows.map((row) => (
          <li key={row.id}>
            <strong>{movementLabel(row)}</strong>
            <span>
              {sourceLabel(row.source)}
              {row.reason ? ` · ${row.reason}` : ''}
              {row.actor ? ` · ${row.actor.name}` : ''}
            </span>
            <time dateTime={row.createdAt}>{dateLabel(row.createdAt)}</time>
          </li>
        ))}
      </ol>
      {query.hasNextPage && (
        <button type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  )
}

function movementLabel(row: StockMovement) {
  if (row.fromQuantity == null && row.toQuantity != null) return `Set to ${row.toQuantity}`
  if (row.fromQuantity != null && row.toQuantity == null) return `Cleared (was ${row.fromQuantity})`
  if (row.delta != null && row.delta > 0) return `${row.fromQuantity} → ${row.toQuantity} (+${row.delta})`
  if (row.delta != null && row.delta < 0) return `${row.fromQuantity} → ${row.toQuantity} (${row.delta})`
  return `${row.fromQuantity ?? '—'} → ${row.toQuantity ?? '—'}`
}

function sourceLabel(source: StockMovement['source']) {
  if (source === 'adjust') return 'Adjustment'
  if (source === 'import') return 'Import'
  return 'Edit'
}
