import { useState, type FormEvent } from 'react'
import { ApiError, useUpdateInventoryItem, type InventoryItem } from '@project/sdk'
import { RecordFormDialog } from './RecordChrome'

/** Sets quantity directly — not a stock ledger. */
export function StockAdjust({
  item,
  workspaceId,
  onClose,
}: {
  item: InventoryItem
  workspaceId: string
  onClose: () => void
}) {
  const update = useUpdateInventoryItem(workspaceId)
  const current = item.quantity ?? 0
  const [quantity, setQuantity] = useState(String(current))
  const [error, setError] = useState('')
  const next = Number(quantity)
  const valid = quantity.trim() !== '' && Number.isInteger(next) && next >= 0
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!valid) return setError('Enter a whole stock quantity of zero or more.')
    try {
      await update.mutateAsync({
        inventoryId: item.id,
        expectedVersion: item.version,
        quantity: next,
      })
      onClose()
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'INVENTORY_VERSION_CONFLICT'
          ? 'This item changed elsewhere. Refresh and try again.'
          : err instanceof Error
            ? err.message
            : 'Could not update stock. Try again.',
      )
    }
  }
  return (
    <RecordFormDialog title="Adjust stock" onClose={onClose}>
      <form className="record-form" onSubmit={save}>
        <div className="record-form-fields">
          <p className="record-muted">{item.name}</p>
          <dl className="record-stock-summary">
            <div>
              <dt>Current</dt>
              <dd>{current}</dd>
            </div>
            <div>
              <dt>New quantity</dt>
              <dd>
                <input
                  aria-label="New quantity"
                  autoFocus
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </dd>
            </div>
            <div>
              <dt>Result</dt>
              <dd>{valid ? next : '—'}</dd>
            </div>
          </dl>
          {error && (
            <p role="alert" className="record-error">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose} disabled={update.isPending}>
            Cancel
          </button>
          <button className="record-primary" disabled={update.isPending || !valid}>
            {update.isPending ? 'Saving…' : 'Save quantity'}
          </button>
        </footer>
      </form>
    </RecordFormDialog>
  )
}
