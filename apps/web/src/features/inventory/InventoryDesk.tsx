import { useState, type FormEvent } from 'react'
import { useCreateInventoryItem, useDeleteInventoryItem, useInventory, useUpdateInventoryItem, type InventoryItem } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import '../work/work.css'
import './desks.css'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const stockOf = (item: InventoryItem) => (item.quantity === null ? 'Service' : item.quantity === 0 ? 'Out of stock' : `${item.quantity} in stock`)

const EMPTY = { name: '', price: '', category: '', quantity: '', sku: '' }

export function InventoryDesk() {
  const { workspace, loading } = useCurrentWorkspace()
  const [filter, setFilter] = useState('')
  const [archived, setArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)

  const list = useInventory(workspace?.id, { q: filter.trim() || undefined, status: archived ? 'archived' : 'active' })
  const create = useCreateInventoryItem(workspace?.id ?? '')
  const update = useUpdateInventoryItem(workspace?.id ?? '')
  const remove = useDeleteInventoryItem(workspace?.id ?? '')
  const items = list.data?.pages.flatMap((page) => page.data) ?? []

  if (loading || !workspace) return null

  const save = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const price = form.price.trim() === '' ? 0 : Number(form.price)
    const quantity = form.quantity.trim() === '' ? null : Number(form.quantity)
    if (!form.name.trim()) return setError('Give it a name.')
    if (!Number.isFinite(price) || price < 0) return setError('Price must be zero or more.')
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0)) return setError('Stock must be a whole number, or empty for a service.')
    create.mutate(
      { name: form.name, price, category: form.category || null, quantity, sku: form.sku || null },
      {
        onSuccess: () => { setForm(EMPTY); setAdding(false) },
        onError: (err: any) => setError(err?.code === 'SKU_TAKEN' ? 'Another item already uses that code.' : 'Could not save. Try again.'),
      },
    )
  }

  const field = (key: keyof typeof EMPTY, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="work-field">
      <span>{label}</span>
      <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </label>
  )

  return (
    <div className="work-frame desk" aria-label="Inventory">
      <div className="work-bar desk-bar">
        <input className="work-filter" type="search" placeholder="Find an item" aria-label="Find an item" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" aria-pressed={archived} onClick={() => setArchived(!archived)}>Archived</button>
        <span className="desk-spacer" />
        <button type="button" className="work-add" onClick={() => setAdding(!adding)} aria-expanded={adding}>{adding ? 'Close' : 'Add item'}</button>
      </div>

      {adding && (
        <form className="work-fields desk-form" onSubmit={save}>
          {field('name', 'Name', { autoFocus: true, required: true, maxLength: 160 })}
          {field('price', 'Price', { inputMode: 'decimal', placeholder: '0.00' })}
          {field('category', 'Category', { maxLength: 80 })}
          {field('quantity', 'In stock', { inputMode: 'numeric', placeholder: 'Empty for a service' })}
          {field('sku', 'Code', { maxLength: 80 })}
          <button type="submit" disabled={create.isPending}>Save</button>
          {error && <p className="work-compose-error" role="alert">{error}</p>}
        </form>
      )}

      {items.length === 0 ? (
        <p className="work-quiet">{list.isLoading ? 'Loading…' : archived ? 'Nothing archived.' : filter ? 'No match.' : 'Nothing here yet. Add what you sell.'}</p>
      ) : (
        <ul className="work-lines">
          {items.map((item) => (
            <li key={item.id} className="work-line desk-line desk-item" data-off={item.availability ? undefined : ''}>
              <span className="work-line-title">
                {item.name}
                {item.sku && <span className="desk-code"> {item.sku}</span>}
              </span>
              <span className="work-who">{item.category ?? ''}</span>
              <span className="desk-price">{money(item.price)}</span>
              <span className="work-mark" data-needs={item.quantity === 0 ? '' : undefined}>{stockOf(item)}</span>
              <span className="desk-actions">
                <button type="button" onClick={() => update.mutate({ inventoryId: item.id, availability: !item.availability })}>
                  {item.availability ? 'Pause' : 'Offer again'}
                </button>
                <button type="button" onClick={() => update.mutate({ inventoryId: item.id, status: archived ? 'active' : 'archived' })}>
                  {archived ? 'Restore' : 'Archive'}
                </button>
                {archived && <button type="button" onClick={() => window.confirm(`Delete ${item.name} for good?`) && remove.mutate(item.id)}>Delete</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && <button type="button" className="desk-more" onClick={() => list.fetchNextPage()}>Show more</button>}
    </div>
  )
}
