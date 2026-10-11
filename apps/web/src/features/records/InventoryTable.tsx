import { useMemo } from 'react'
import { useUpdateInventoryItem, type InventoryItem } from '@project/sdk'
import { ColumnsMenu } from '../collections/ColumnsMenu'
import { DataTable } from '../collections/DataTable'
import { useTableState, type Column, type TableState } from '../collections/table'
import { RecordMedia } from './RecordChrome'
import { dateLabel, priceLabel, stockLabel } from './labels'
import { useSaveFeedback } from './saveFeedback'

type Props = {
  workspaceId: string
  currency: string
  records: InventoryItem[]
  selected: string[]
  sort: string
  dir: string
  onSort: (sort: string) => void
  onSelect: (ids: string[]) => void
  onToggle: (id: string) => void
  href: (id: string) => string
  onOpen: (id: string) => void
  onPreview: (id: string, name: string) => void
  previewId?: string | null
}

/** Inventory's columns (redesign D9). Sorting is the API's (URL `sort`/`dir`). */
export function useInventoryTable(props: Pick<Props, 'workspaceId' | 'currency' | 'href' | 'onOpen' | 'onPreview' | 'sort' | 'dir' | 'onSort'>) {
  const { currency, href, onOpen, onPreview } = props
  const columns = useMemo<Column<InventoryItem>[]>(() => [
    {
      id: 'name', header: 'Item', width: '30%', hideable: false, sortValue: (i) => i.name,
      cell: (item) => (
        <span className="inventory-name-cell">
          <RecordMedia person={false} name={item.name} src={item.imageUrl} />
          <span className="inventory-name-info">
            <a
              href={href(item.id)}
              data-record-link={item.id}
              onClick={(e) => {
                if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onOpen(item.id) }
              }}
            >
              {item.name}
            </a>
            <small className="docs-name-sub">{item.category || item.sku || 'Catalog item'}</small>
          </span>
        </span>
      ),
    },
    { id: 'availability', header: 'Status', sortValue: (i) => (i.availability ? 0 : 1), cell: (item) => <Availability workspaceId={props.workspaceId} item={item} /> },
    { id: 'category', header: 'Category', sortValue: (i) => i.category ?? '', cell: (i) => i.category || '—' },
    { id: 'price', header: 'Price', align: 'end', sortValue: (i) => i.price ?? 0, cell: (i) => priceLabel(i.price, currency) },
    { id: 'quantity', header: 'Stock', align: 'end', sortValue: (i) => i.quantity ?? 0, cell: (i) => <>{stockLabel(i)}{i.location ? <small className="docs-name-sub"> · {i.location}</small> : null}</> },
    { id: 'updated', header: 'Updated', sortValue: (i) => i.updatedAt, cell: (i) => dateLabel(i.updatedAt) },
    { id: 'sku', header: 'SKU', defaultHidden: true, cell: (i) => i.sku || '—' },
    {
      id: 'preview', header: '', width: '7rem', hideable: false,
      cell: (item) => <button type="button" className="collection-row-action" aria-label={`Preview ${item.name}`} onClick={() => onPreview(item.id, item.name)}>Preview</button>,
    },
  ], [currency, href, onOpen, onPreview, props.workspaceId])
  return useTableState('inventory', columns, { id: 'name', dir: 1 }, {
    sort: { id: props.sort, dir: props.dir === 'desc' ? -1 : 1 },
    onSort: props.onSort,
  })
}

export function InventoryColumns({ table }: { table: TableState<InventoryItem> }) {
  return <ColumnsMenu state={table} />
}

/** Inventory as the shared collection table: same frame and table as every list. */
export function InventoryTable({ table, ...props }: Props & { table: TableState<InventoryItem> }) {
  return (
    <DataTable
      label="Inventory"
      rows={props.records}
      getId={(i) => i.id}
      state={table}
      onOpen={(i) => props.onOpen(i.id)}
      rowProps={(i) => ({ 'data-selected': props.previewId === i.id ? '' : undefined })}
      selection={{
        selected: new Set(props.selected),
        limit: 50,
        onChange: (next) => props.onSelect([...next]),
      }}
      empty="No inventory items found."
      tableClass="inventory-table"
    />
  )
}

// Availability is edited in place (a single field; the record keeps its version).
function Availability({ workspaceId, item }: { workspaceId: string; item: InventoryItem }) {
  const update = useUpdateInventoryItem(workspaceId)
  const feedback = useSaveFeedback(update.isPending, update.error)
  return (
    <>
      <select
        className="table-status-select"
        aria-label={`Availability for ${item.name}`}
        value={item.availability ? 'offered' : 'paused'}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ inventoryId: item.id, expectedVersion: item.version, availability: e.target.value === 'offered' })}
      >
        <option value="offered">Offered</option>
        <option value="paused">Paused</option>
      </select>
      {feedback.label && <small role="status" className="table-feedback" data-failed={feedback.failed || undefined}>{feedback.label}</small>}
    </>
  )
}
