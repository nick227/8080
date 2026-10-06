import { useState, type FormEvent } from 'react'
import { ApiError, useAdjustInventoryStock, type InventoryItem } from '@project/sdk'
import { RecordFormDialog } from './RecordChrome'

/** Sets quantity via adjust endpoint — records a stock movement with optional reason. */
export function StockAdjust({
  item,
  workspaceId,
  onClose,
}: {
  item: InventoryItem
  workspaceId: string
  onClose: () => void
}) {
  const adjust = useAdjustInventoryStock(workspaceId)
  const current = item.quantity ?? 0
  const [quantity, setQuantity] = useState(String(current))
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const next = Number(quantity)
  const valid = quantity.trim() !== '' && Number.isInteger(next) && next >= 0
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!valid) return setError('Enter a whole stock quantity of zero or more.')
    try {
      await adjust.mutateAsync({
        inventoryId: item.id,
        expectedVersion: item.version,
        quantity: next,
        reason: reason.trim() || null,
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
          <label>
            <span>Reason (optional)</span>
            <input maxLength={240} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Received shipment, sold, counted…" />
          </label>
          {error && (
            <p role="alert" className="record-error">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose} disabled={adjust.isPending}>
            Cancel
          </button>
          <button className="record-primary" disabled={adjust.isPending || !valid}>
            {adjust.isPending ? 'Saving…' : 'Save quantity'}
          </button>
        </footer>
      </form>
    </RecordFormDialog>
  )
}
