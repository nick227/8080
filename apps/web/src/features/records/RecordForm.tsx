import { useEffect, useState, type FormEvent } from 'react'
import {
  useCreateContact,
  useCreateInventoryItem,
  useUpdateContact,
  useUpdateInventoryItem,
  type Contact,
  type InventoryItem,
} from '@project/sdk'
import { RecordFormDialog } from './RecordChrome'
import type { RecordKind } from './navigation'

export function RecordForm({
  kind,
  workspaceId,
  contact,
  item,
  onClose,
  onSaved,
}: {
  kind: RecordKind
  workspaceId: string
  contact?: Contact
  item?: InventoryItem
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [initial] = useState(() => ({
    name: contact?.displayName ?? item?.name ?? '',
    source: contact?.leadSource ?? '',
    price: String(item?.price ?? ''),
    sku: item?.sku ?? '',
    category: item?.category ?? '',
    description: item?.description ?? '',
    tracking: item?.quantity != null,
    quantity: String(item?.quantity ?? ''),
    image: item?.imageUrl ?? '',
  }))
  const draftKey = `records.draft:${workspaceId}:${kind}:${contact?.id ?? item?.id ?? 'new'}`
  const [restoredDraft] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) || 'null')
      if (
        saved &&
        Object.keys(initial).every((key) => typeof saved[key] === typeof initial[key as keyof typeof initial])
      )
        return saved as typeof initial
    } catch {
      /* Storage may be unavailable. */
    }
    return null
  })
  const [form, setForm] = useState(restoredDraft ?? initial)
  const [error, setError] = useState('')
  const createContact = useCreateContact(workspaceId)
  const createItem = useCreateInventoryItem(workspaceId)
  const updateContact = useUpdateContact(workspaceId)
  const updateItem = useUpdateInventoryItem(workspaceId)
  const pending =
    createContact.isPending || createItem.isPending || updateContact.isPending || updateItem.isPending
  const dirty = JSON.stringify(initial) !== JSON.stringify(form)
  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify(form))
      else sessionStorage.removeItem(draftKey)
    } catch {
      /* Keep editing in memory. */
    }
  }, [draftKey, dirty, form])
  const clearDraft = () => {
    try {
      sessionStorage.removeItem(draftKey)
    } catch {
      /* Optional persistence. */
    }
  }
  const saved = (id: string) => {
    clearDraft()
    onSaved(id)
  }
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const close = () => {
    if (!pending && (!dirty || window.confirm('Discard unsaved changes?'))) {
      clearDraft()
      onClose()
    }
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!form.name.trim()) return setError('Enter a name.')
    try {
      if (kind === 'contacts') {
        const data = { displayName: form.name.trim(), leadSource: form.source.trim() || null }
        if (contact)
          await updateContact.mutateAsync({
            ...data,
            contactId: contact.id,
            expectedVersion: contact.version,
          })
        else {
          const result = await createContact.mutateAsync(data)
          saved(result.data.id)
          return
        }
      } else {
        const price = form.price.trim() ? Number(form.price) : 0
        const quantity = form.tracking ? Number(form.quantity) : null
        if (!Number.isFinite(price) || price < 0) return setError('Enter a price of zero or more.')
        if (form.tracking && (!form.quantity.trim() || !Number.isInteger(quantity) || quantity! < 0))
          return setError('Enter a whole stock quantity of zero or more.')
        const data = {
          name: form.name.trim(),
          price,
          quantity,
          sku: form.sku.trim() || null,
          category: form.category.trim() || null,
          description: form.description.trim() || null,
          imageUrl: form.image.trim() || null,
        }
        if (item) await updateItem.mutateAsync({ ...data, inventoryId: item.id })
        else {
          const result = await createItem.mutateAsync(data)
          saved(result.id)
          return
        }
      }
      saved(contact?.id ?? item!.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Your changes are still here; try again.')
    }
  }
  const field = (
    key: Exclude<keyof typeof form, 'tracking'>,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <label>
      <span>{label}</span>
      <input
        {...props}
        value={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
      />
    </label>
  )
  const title = `${contact || item ? 'Edit' : 'Add'} ${kind === 'contacts' ? 'contact' : 'inventory item'}`
  return (
    <RecordFormDialog title={title} onClose={close}>
      <form className="record-form" onSubmit={save}>
        <div className="record-form-fields">
          {restoredDraft && (
            <p className="record-muted" role="status">
              Your unfinished changes have been restored.
            </p>
          )}
          {field('name', 'Name', { autoFocus: true, required: true, maxLength: 160 })}
          {kind === 'contacts' ? (
            field('source', 'Source', { maxLength: 80 })
          ) : (
            <>
              <div className="record-field-pair">
                {field('price', 'Price', { inputMode: 'decimal', placeholder: '0.00' })}
                {field('sku', 'SKU', { maxLength: 80 })}
              </div>
              {field('category', 'Category', { maxLength: 80 })}
              <label>
                <span>Description</span>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={4}
                />
              </label>
              {field('image', 'Primary image URL', { type: 'url', maxLength: 255, placeholder: 'https://…' })}
              <label className="record-checkbox">
                <input
                  type="checkbox"
                  checked={form.tracking}
                  onChange={(e) => {
                    const tracking = e.target.checked
                    if (
                      !tracking &&
                      item?.quantity != null &&
                      !window.confirm('Stop tracking stock? The saved quantity will be cleared.')
                    )
                      return
                    setForm({ ...form, tracking })
                  }}
                />
                <span>Track stock for this item</span>
              </label>
              {form.tracking ? (
                field('quantity', 'In stock', { required: true, inputMode: 'numeric', placeholder: '0' })
              ) : (
                <p className="record-muted">
                  Products and services can both be offered without a stock count.
                </p>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="record-error">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" onClick={close} disabled={pending}>
            Cancel
          </button>
          <button className="record-primary" disabled={pending}>
            {pending ? 'Saving…' : contact || item ? 'Save changes' : 'Create'}
          </button>
        </footer>
      </form>
    </RecordFormDialog>
  )
}
