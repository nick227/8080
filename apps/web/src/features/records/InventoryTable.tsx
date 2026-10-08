import { useUpdateInventoryItem, type InventoryItem } from '@project/sdk'
import { RecordMedia } from './RecordChrome'
import { dateLabel, priceLabel, stockLabel } from './labels'
import { useSaveFeedback } from './saveFeedback'

type SortKey = 'name' | 'availability' | 'category' | 'price' | 'quantity' | 'updated'

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

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Item' },
  { key: 'availability', label: 'Status' },
  { key: 'category', label: 'Category' },
  { key: 'price', label: 'Price' },
  { key: 'quantity', label: 'Stock' },
  { key: 'updated', label: 'Updated' },
]

export function InventoryTable(props: Props) {
  const scope = props.records.slice(0, 50).map((i) => i.id)
  const allSelected = scope.length > 0 && scope.every((id) => props.selected.includes(id))

  const selectionHeader = (
    <input
      type="checkbox"
      aria-label={`Select first ${scope.length} loaded items`}
      checked={allSelected}
      onChange={() => props.onSelect(allSelected ? [] : scope)}
    />
  )

  return (
    <div className="docs-table-wrap inventory-table-scroll" tabIndex={0} role="region" aria-label="Inventory table">
      <table className="docs-table inventory-table">
        <caption className="record-sr-only">Inventory items catalog. Edit availability directly.</caption>
        <thead>
          <tr>
            <th className="table-col-check">{selectionHeader}</th>
            {COLUMNS.map((col) => {
              const active = props.sort === col.key
              return (
                <th key={col.key} className={`table-col-${col.key}`} aria-sort={active ? (props.dir === 'desc' ? 'descending' : 'ascending') : 'none'}>
                  <button type="button" className="docs-sort" data-active={active || undefined} onClick={() => props.onSort(col.key)}>
                    {col.label}
                    <span className="docs-sort-dir" aria-hidden>{active ? (props.dir === 'desc' ? '↓' : '↑') : '↕'}</span>
                  </button>
                </th>
              )
            })}
            <th className="docs-col-action">
              <span className="docs-sort">Preview</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.records.length === 0 ? (
            <tr className="docs-none">
              <td colSpan={8}>No inventory items found.</td>
            </tr>
          ) : (
            props.records.map((item) => (
              <InventoryTableRow
                key={item.id}
                item={item}
                {...props}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function InventoryTableRow({ item, ...props }: Props & { item: InventoryItem }) {
  const update = useUpdateInventoryItem(props.workspaceId)
  const feedback = useSaveFeedback(update.isPending, update.error)
  const checked = props.selected.includes(item.id)
  const selected = props.previewId === item.id

  return (
    <tr
      data-selected={checked || selected || undefined}
      onClick={() => props.onOpen(item.id)}
    >
      <td className="table-col-check" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${item.name}`}
          checked={checked}
          onChange={() => props.onToggle(item.id)}
        />
      </td>

      <td className="table-col-name">
        <div className="inventory-name-cell">
          <RecordMedia person={false} name={item.name} src={item.imageUrl} />
          <div className="inventory-name-info">
            <a
              href={props.href(item.id)}
              data-record-link={item.id}
              onClick={(e) => {
                if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                  e.preventDefault()
                  props.onOpen(item.id)
                }
              }}
            >
              {item.name}
            </a>
            <small className="docs-name-sub">{item.category || item.sku || 'Catalog item'}</small>
          </div>
        </div>
      </td>

      <td className="table-col-status" onClick={(e) => e.stopPropagation()}>
        <select
          className="table-status-select"
          aria-label={`Availability for ${item.name}`}
          value={item.availability ? 'offered' : 'paused'}
          disabled={update.isPending}
          onChange={(e) =>
            update.mutate({
              inventoryId: item.id,
              expectedVersion: item.version,
              availability: e.target.value === 'offered',
            })
          }
        >
          <option value="offered">Offered</option>
          <option value="paused">Paused</option>
        </select>
        {feedback.label && (
          <small role="status" className="table-feedback" data-failed={feedback.failed || undefined}>
            {feedback.label}
          </small>
        )}
      </td>

      <td className="table-col-category">{item.category || '—'}</td>

      <td className="table-col-price">{priceLabel(item.price, props.currency)}</td>

      <td className="table-col-stock">
        {stockLabel(item)}
        {item.location ? <small className="docs-name-sub"> · {item.location}</small> : null}
      </td>

      <td className="table-col-updated">{dateLabel(item.updatedAt)}</td>

      <td className="docs-col-action" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="docs-preview-btn"
          aria-label={`Preview ${item.name}`}
          onClick={() => props.onPreview(item.id, item.name)}
        >
          Preview ↗
        </button>
      </td>
    </tr>
  )
}
