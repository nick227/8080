import { useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  getApiClient,
  unwrap,
  useCreateAccount,
  useCreateContact,
  useCreateInventoryItem,
  useUpdateContact,
  useUpdateInventoryItem,
  useWorkspaceMembers,
  type Contact,
  type ContactRef,
  type InventoryItem,
} from '@project/sdk'
import { RecordFormDialog } from './RecordChrome'
import { ContactFields, InventoryFields, type FormDraft } from './formFields'
import type { RecordKind } from './navigation'

export function RecordForm({
  kind,
  workspaceId,
  currency = 'USD',
  contact,
  item,
  onClose,
  onSaved,
  onOpenRecord,
}: {
  kind: RecordKind
  workspaceId: string
  currency?: string
  contact?: Contact
  item?: InventoryItem
  onClose: () => void
  onSaved: (id: string) => void
  onOpenRecord?: (kind: RecordKind, id: string) => void
}) {
  const primary = contact?.accounts.find((a) => a.isPrimary) ?? contact?.accounts[0]
  const [initial] = useState<FormDraft>(() => ({
    name: contact?.displayName ?? item?.name ?? '',
    email: contact?.primaryEmail ?? '',
    phone: contact?.primaryPhone ?? '',
    company: primary?.name ?? '',
    stage: contact?.leadStatus ?? 'new',
    ownerId: contact?.ownerMemberId ?? '',
    source: contact?.leadSource ?? '',
    price: item ? String(item.price) : '',
    sku: item?.sku ?? '',
    category: item?.category ?? '',
    description: item?.description ?? '',
    offered: item?.availability ?? true,
    tracking: item?.quantity != null,
    quantity: String(item?.quantity ?? ''),
    threshold: item?.lowStockThreshold != null ? String(item.lowStockThreshold) : '',
    location: item?.location ?? '',
    image: item?.imageUrl ?? '',
  }))
  const draftKey = `records.draft:${workspaceId}:${kind}:${contact?.id ?? item?.id ?? 'new'}`
  const [restoredDraft] = useState(() => readDraft(draftKey, initial))
  const [form, setForm] = useState(restoredDraft ?? initial)
  const [fieldError, setFieldError] = useState<Partial<Record<keyof FormDraft, string>>>({})
  const [error, setError] = useState('')
  const [duplicates, setDuplicates] = useState<ContactRef[] | null>(null)
  const [skuConflictId, setSkuConflictId] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const members = useWorkspaceMembers(kind === 'contacts' ? workspaceId : undefined)
  const createContact = useCreateContact(workspaceId)
  const createAccount = useCreateAccount(workspaceId)
  const createItem = useCreateInventoryItem(workspaceId)
  const updateContact = useUpdateContact(workspaceId)
  const updateItem = useUpdateInventoryItem(workspaceId)
  const pending =
    createContact.isPending ||
    createAccount.isPending ||
    createItem.isPending ||
    updateContact.isPending ||
    updateItem.isPending
  const dirty = JSON.stringify(initial) !== JSON.stringify(form)
  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify(form))
      else sessionStorage.removeItem(draftKey)
    } catch {
      /* Keep editing in memory. */
    }
  }, [draftKey, dirty, form])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const clearDraft = () => {
    try {
      sessionStorage.removeItem(draftKey)
    } catch {
      /* Optional persistence. */
    }
  }
  const finish = (id: string) => {
    clearDraft()
    onSaved(id)
  }
  const close = () => {
    if (!pending && (!dirty || window.confirm('Discard unsaved changes?'))) {
      clearDraft()
      onClose()
    }
  }
  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFieldError((current) => ({ ...current, [key]: undefined }))
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSkuConflictId(null)
    const nextErrors: Partial<Record<keyof FormDraft, string>> = {}
    if (!form.name.trim()) nextErrors.name = 'Enter a name.'
    if (kind === 'inventory') {
      const price = form.price.trim() ? Number(form.price) : 0
      if (!Number.isFinite(price) || price < 0) nextErrors.price = 'Enter a price of zero or more.'
      if (form.tracking) {
        const quantity = Number(form.quantity)
        if (!form.quantity.trim() || !Number.isInteger(quantity) || quantity < 0)
          nextErrors.quantity = 'Enter a whole stock quantity of zero or more.'
        if (form.threshold.trim()) {
          const threshold = Number(form.threshold)
          if (!Number.isInteger(threshold) || threshold < 0)
            nextErrors.threshold = 'Enter a whole number of zero or more, or leave blank.'
        }
      }
    }
    setFieldError(nextErrors)
    if (Object.keys(nextErrors).length) return
    try {
      if (kind === 'contacts') await saveContact()
      else await saveInventory()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SKU_TAKEN' && form.sku.trim()) {
        const match = await findSku(workspaceId, form.sku.trim(), item?.id)
        setSkuConflictId(match)
        setError(match ? 'That SKU is already used.' : err.message)
        return
      }
      if (err instanceof ApiError && err.code === 'INVENTORY_VERSION_CONFLICT') {
        setError('This item changed elsewhere. Refresh and try again.')
        return
      }
      setError(err instanceof Error ? err.message : 'Could not save. Your changes are still here; try again.')
    }
  }
  const saveContact = async () => {
    const points = [
      ...(form.email.trim() ? [{ kind: 'email' as const, value: form.email.trim(), isPrimary: true }] : []),
      ...(form.phone.trim() ? [{ kind: 'phone' as const, value: form.phone.trim(), isPrimary: true }] : []),
      ...(contact?.points
        .filter((point) => point.kind !== 'email' && point.kind !== 'phone')
        .map((point) => ({
          kind: point.kind,
          value: point.value,
          label: point.label,
          isPrimary: point.isPrimary,
          shared: point.shared,
        })) ?? []),
    ]
    const body = {
      displayName: form.name.trim(),
      leadStatus: form.stage,
      ownerMemberId: form.ownerId || null,
      leadSource: form.source.trim() || null,
      points: points.length ? points : contact ? [] : undefined,
      accounts:
        !contact && form.company.trim()
          ? [{ accountId: (await createAccount.mutateAsync({ name: form.company.trim() })).data.id, isPrimary: true }]
          : undefined,
    }
    if (contact) {
      const { accounts: _accounts, ...patch } = body
      await updateContact.mutateAsync({ ...patch, contactId: contact.id, expectedVersion: contact.version })
      finish(contact.id)
      return
    }
    const result = await createContact.mutateAsync(body)
    if (result.duplicates.length) {
      setCreatedId(result.data.id)
      setDuplicates(result.duplicates)
      clearDraft()
      return
    }
    finish(result.data.id)
  }
  const saveInventory = async () => {
    const price = form.price.trim() ? Number(form.price) : 0
    const quantity = form.tracking ? Number(form.quantity) : null
    const data = {
      name: form.name.trim(),
      price,
      quantity,
      lowStockThreshold: form.tracking && form.threshold.trim() ? Number(form.threshold) : null,
      location: form.location.trim() || null,
      availability: form.offered,
      sku: form.sku.trim() || null,
      category: form.category.trim() || null,
      description: form.description.trim() || null,
      imageUrl: form.image.trim() || null,
    }
    if (item) {
      await updateItem.mutateAsync({ ...data, inventoryId: item.id, expectedVersion: item.version })
      finish(item.id)
      return
    }
    finish((await createItem.mutateAsync(data)).id)
  }
  const title = `${contact || item ? 'Edit' : 'Add'} ${kind === 'contacts' ? 'contact' : 'inventory item'}`
  if (duplicates && createdId)
    return (
      <RecordFormDialog title="Possible duplicates" onClose={() => finish(createdId)}>
        <div className="record-form-fields">
          <p>Created. These contacts may already cover the same person:</p>
          <ul className="record-related">
            {duplicates.map((dup) => (
              <li key={dup.id}>
                <button
                  type="button"
                  className="record-related-name"
                  onClick={() => {
                    onOpenRecord?.('contacts', dup.id)
                    onClose()
                  }}
                >
                  {dup.displayName}
                  <small>{dup.primaryEmail || 'Open existing contact'}</small>
                </button>
              </li>
            ))}
          </ul>
          <footer>
            <button type="button" className="record-primary" onClick={() => finish(createdId)}>
              Keep and open new contact
            </button>
          </footer>
        </div>
      </RecordFormDialog>
    )
  return (
    <RecordFormDialog title={title} onClose={close}>
      <form className="record-form" onSubmit={save}>
        <div className="record-form-fields">
          {restoredDraft && (
            <p className="record-muted" role="status">
              Your unfinished changes have been restored.
            </p>
          )}
          {kind === 'contacts' ? (
            <ContactFields
              form={form}
              set={set}
              fieldError={fieldError}
              members={members.data ?? []}
              creating={!contact}
            />
          ) : (
            <InventoryFields form={form} set={set} fieldError={fieldError} currency={currency} item={item} />
          )}
          {error && (
            <p role="alert" className="record-error">
              {error}
              {skuConflictId && onOpenRecord && (
                <>
                  {' '}
                  <button type="button" onClick={() => onOpenRecord('inventory', skuConflictId)}>
                    Open existing item
                  </button>
                </>
              )}
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

function readDraft(key: string, initial: FormDraft) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (saved && Object.keys(initial).every((k) => typeof saved[k] === typeof initial[k as keyof FormDraft]))
      return saved as FormDraft
  } catch {
    /* Storage may be unavailable. */
  }
  return null
}

async function findSku(workspaceId: string, sku: string, except?: string) {
  const page = unwrap(
    await getApiClient().GET('/workspaces/{workspaceId}/inventory', {
      params: { path: { workspaceId }, query: { q: sku, status: 'active' } },
    }),
  )
  return page.data.find((row) => row.sku === sku && row.id !== except)?.id ?? null
}
