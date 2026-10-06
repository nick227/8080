import { useState } from 'react'
import {
  useContact,
  useInventoryItem,
  useUpdateContact,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useContactInterests,
  useAddContactInterest,
  useRemoveContactInterest,
  useInventory,
  useRecordTimeline,
  type Contact,
  type InventoryItem,
  type LeadStatus,
} from '@project/sdk'
import { RecordMedia } from './RecordChrome'
import { RecordForm } from './RecordForm'
import type { RecordKind, RecordRef } from './navigation'

export const STAGES: LeadStatus[] = ['new', 'contacting', 'connected', 'qualified', 'customer', 'lost']
export const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
export const dateLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Not set'
export const localDay = (value: string | null) => {
  if (!value) return ''
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const priceLabel = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const stockLabel = (item: InventoryItem) =>
  item.quantity === null
    ? 'Stock not tracked'
    : item.quantity === 0
      ? 'Out of stock'
      : `${item.quantity} in stock`
export const contactSubtitle = (contact: Contact) =>
  contact.accounts.find((account) => account.isPrimary)?.name ??
  contact.accounts[0]?.name ??
  contact.primaryEmail ??
  contact.title ??
  'Contact'

export function RecordDetail({
  kind,
  id,
  workspaceId,
  onRelated,
  onMessage,
  onDeleted,
}: {
  kind: RecordKind
  id: string
  workspaceId: string
  onRelated: (ref: RecordRef) => void
  onMessage: (id: string) => void
  onDeleted: () => void
}) {
  const contact = useContact(kind === 'contacts' ? workspaceId : undefined, id)
  const item = useInventoryItem(kind === 'inventory' ? workspaceId : undefined, id)
  const query = kind === 'contacts' ? contact : item
  if (query.isLoading)
    return (
      <div className="record-loading" role="status">
        Loading record…
      </div>
    )
  if (query.isError || !query.data)
    return (
      <div className="record-empty">
        <h2>Could not open this record</h2>
        <p>It may have been removed, or the connection was interrupted.</p>
        <button onClick={() => query.refetch()}>Try again</button>
      </div>
    )
  return kind === 'contacts' ? (
    <ContactDetail
      key={id}
      contact={contact.data!}
      workspaceId={workspaceId}
      onRelated={onRelated}
      onMessage={onMessage}
    />
  ) : (
    <InventoryDetail key={id} item={item.data!} workspaceId={workspaceId} onDeleted={onDeleted} />
  )
}

function ContactDetail({
  contact: c,
  workspaceId,
  onRelated,
  onMessage,
}: {
  contact: Contact
  workspaceId: string
  onRelated: (ref: RecordRef) => void
  onMessage: (id: string) => void
}) {
  const update = useUpdateContact(workspaceId)
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState('overview')
  const change = (data: Parameters<typeof update.mutate>[0]) =>
    update.mutate({ expectedVersion: c.version, ...data })
  return (
    <article className="record-detail">
      <header className="record-masthead">
        <RecordMedia name={c.displayName} person />
        <div className="record-identity">
          <span className="record-eyebrow">Contact{c.status === 'archived' && ' · Archived'}</span>
          <h1>{c.displayName}</h1>
          <p>{contactSubtitle(c)}</p>
          <div className="record-actions">
            <button className="record-primary" onClick={() => onMessage(c.id)}>
              Message
            </button>
            <button onClick={() => setEditing(true)}>Edit</button>
            <button
              disabled={update.isPending}
              onClick={() =>
                change({ contactId: c.id, status: c.status === 'archived' ? 'active' : 'archived' })
              }
            >
              {c.status === 'archived' ? 'Restore' : 'Archive'}
            </button>
          </div>
        </div>
        <label className="record-state">
          <span>Stage</span>
          <select
            aria-label="Lead stage"
            value={c.leadStatus ?? 'new'}
            disabled={update.isPending}
            onChange={(e) => change({ contactId: c.id, leadStatus: e.target.value as LeadStatus })}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="record-attention">
        <label>
          Next follow-up{' '}
          <input
            aria-label="Next follow-up"
            type="date"
            value={localDay(c.nextFollowUp)}
            disabled={update.isPending}
            onChange={(e) =>
              change({
                contactId: c.id,
                nextFollowUp: e.target.value ? new Date(`${e.target.value}T09:00:00`).toISOString() : null,
              })
            }
          />
        </label>
        <span role="status">
          {update.isPending
            ? 'Saving…'
            : update.isSuccess
              ? 'Saved'
              : c.nextFollowUp
                ? dateLabel(c.nextFollowUp)
                : 'Set the next step for this relationship'}
        </span>
      </div>
      {update.isError && (
        <p role="alert" className="record-error">
          Could not save this change. Try again.
        </p>
      )}
      <nav className="record-tabs" aria-label="Contact sections">
        {['overview', 'activity'].map((value) => (
          <button key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>
            {titleCase(value)}
          </button>
        ))}
      </nav>
      {tab === 'activity' ? (
        <Activity workspaceId={workspaceId} contactId={c.id} />
      ) : (
        <div className="record-body">
          <div className="record-main">
            <section>
              <h2>Relationship</h2>
              <p>{c.title || 'Add a title and company information as this relationship develops.'}</p>
              {c.accounts.map((account) => (
                <p key={account.accountId}>
                  {account.name}
                  {account.role && ` · ${account.role}`}
                </p>
              ))}
              {c.tags.length > 0 && (
                <div className="record-tags">
                  {c.tags.map((tag) => (
                    <span key={tag.id}>{tag.name}</span>
                  ))}
                </div>
              )}
            </section>
            <ContactInterests workspaceId={workspaceId} contactId={c.id} onRelated={onRelated} />
            <section>
              <h2>Recent activity</h2>
              <Activity workspaceId={workspaceId} contactId={c.id} compact />
            </section>
          </div>
          <aside className="record-properties">
            <h2>Properties</h2>
            <dl>
              <dt>Email</dt>
              <dd>
                {c.primaryEmail ? <a href={`mailto:${c.primaryEmail}`}>{c.primaryEmail}</a> : 'Not set'}
              </dd>
              <dt>Phone</dt>
              <dd>{c.primaryPhone ? <a href={`tel:${c.primaryPhone}`}>{c.primaryPhone}</a> : 'Not set'}</dd>
              <dt>Source</dt>
              <dd>{c.leadSource || 'Not set'}</dd>
              <dt>Last activity</dt>
              <dd>{dateLabel(c.lastActivityAt)}</dd>
            </dl>
            <RecordDates created={c.createdAt} updated={c.updatedAt} />
            <button onClick={() => setEditing(true)}>Edit properties</button>
          </aside>
        </div>
      )}
      {editing && (
        <RecordForm
          kind="contacts"
          workspaceId={workspaceId}
          contact={c}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
    </article>
  )
}

function InventoryDetail({
  item,
  workspaceId,
  onDeleted,
}: {
  item: InventoryItem
  workspaceId: string
  onDeleted: () => void
}) {
  const update = useUpdateInventoryItem(workspaceId)
  const remove = useDeleteInventoryItem(workspaceId)
  const [editing, setEditing] = useState(false)
  return (
    <article className="record-detail">
      <header className="record-masthead">
        <RecordMedia name={item.name} src={item.imageUrl} />
        <div className="record-identity">
          <span className="record-eyebrow">Inventory{item.status === 'archived' && ' · Archived'}</span>
          <h1>{item.name}</h1>
          <p>{[item.category, item.sku].filter(Boolean).join(' · ') || 'Catalog item'}</p>
          <div className="record-actions">
            <button className="record-primary" onClick={() => setEditing(true)}>
              Edit item
            </button>
            <button
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  inventoryId: item.id,
                  expectedVersion: item.version,
                  status: item.status === 'archived' ? 'active' : 'archived',
                })
              }
            >
              {item.status === 'archived' ? 'Restore' : 'Archive'}
            </button>
            {item.status === 'archived' && (
              <button
                disabled={remove.isPending}
                onClick={() =>
                  window.confirm(`Permanently delete ${item.name}?`) &&
                  remove.mutate(item.id, { onSuccess: onDeleted })
                }
              >
                Delete
              </button>
            )}
          </div>
        </div>
        <label className="record-state">
          <span>Availability</span>
          <select
            aria-label="Availability"
            value={item.availability ? 'offered' : 'paused'}
            disabled={update.isPending}
            onChange={(e) =>
              update.mutate({ inventoryId: item.id, expectedVersion: item.version, availability: e.target.value === 'offered' })
            }
          >
            <option value="offered">Offered</option>
            <option value="paused">Paused</option>
          </select>
        </label>
      </header>
      <div className="record-attention">
        <strong>{stockLabel(item)}</strong>
        <span role="status">
          {update.isPending
            ? 'Saving…'
            : update.isSuccess
              ? 'Saved'
              : item.availability
                ? 'Offered in your catalog'
                : 'Offering paused'}
        </span>
      </div>
      {(update.isError || remove.isError) && (
        <p className="record-error" role="alert">
          Could not save this change. Try again.
        </p>
      )}
      <div className="record-body">
        <div className="record-main">
          {item.imageUrl && (
            <div className="record-gallery">
              <RecordMedia name={item.name} src={item.imageUrl} />
            </div>
          )}
          <section>
            <h2>Description</h2>
            <p className="record-description">
              {item.description || 'Add a description to help your team understand this item.'}
            </p>
          </section>
        </div>
        <aside className="record-properties">
          <h2>Properties</h2>
          <dl>
            <dt>Price</dt>
            <dd className="record-price">{priceLabel(item.price)}</dd>
            <dt>Category</dt>
            <dd>{item.category || 'Not set'}</dd>
            <dt>SKU</dt>
            <dd>{item.sku || 'Not set'}</dd>
            <dt>Stock</dt>
            <dd>{stockLabel(item)}</dd>
            <dt>Lifecycle</dt>
            <dd>{titleCase(item.status)}</dd>
          </dl>
          <RecordDates created={item.createdAt} updated={item.updatedAt} />
          <button onClick={() => setEditing(true)}>Edit properties</button>
        </aside>
      </div>
      {editing && (
        <RecordForm
          kind="inventory"
          workspaceId={workspaceId}
          item={item}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
    </article>
  )
}
function RecordDates({ created, updated }: { created: string; updated: string }) {
  return (
    <details className="record-dates">
      <summary>Record information</summary>
      <dl>
        <dt>Created</dt>
        <dd>{dateLabel(created)}</dd>
        <dt>Updated</dt>
        <dd>{dateLabel(updated)}</dd>
      </dl>
    </details>
  )
}
function Activity({
  workspaceId,
  contactId,
  compact = false,
}: {
  workspaceId: string
  contactId: string
  compact?: boolean
}) {
  const timeline = useRecordTimeline(workspaceId, { contactId })
  const entries = timeline.data?.pages.flatMap((page) => page.data) ?? []
  if (timeline.isError)
    return (
      <p role="alert">
        Could not load activity. <button onClick={() => timeline.refetch()}>Try again</button>
      </p>
    )
  return (
    <div className="record-activity">
      {timeline.isLoading ? (
        <p role="status">Loading activity…</p>
      ) : entries.length === 0 ? (
        <p className="record-muted">No activity recorded yet.</p>
      ) : (
        <ol>
          {(compact ? entries.slice(0, 3) : entries).map((entry) => (
            <li key={entry.id}>
              <span>{titleCase(entry.type.replace(/[._]/g, ' '))}</span>
              <small>
                {entry.actor?.name ?? 'System'} · {dateLabel(entry.occurredAt)}
              </small>
            </li>
          ))}
        </ol>
      )}
      {!compact && timeline.hasNextPage && (
        <button disabled={timeline.isFetchingNextPage} onClick={() => timeline.fetchNextPage()}>
          Show more activity
        </button>
      )}
    </div>
  )
}
function ContactInterests({
  workspaceId,
  contactId,
  onRelated,
}: {
  workspaceId: string
  contactId: string
  onRelated: (ref: RecordRef) => void
}) {
  const interests = useContactInterests(workspaceId, contactId)
  const catalog = useInventory(workspaceId)
  const add = useAddContactInterest(workspaceId)
  const drop = useRemoveContactInterest(workspaceId)
  const chosen = new Set(interests.data?.map((interest) => interest.item.id))
  const choices = (catalog.data?.pages.flatMap((page) => page.data) ?? []).filter(
    (item) => !chosen.has(item.id),
  )
  return (
    <section>
      <h2>Interested in</h2>
      {interests.isLoading && <p role="status">Loading interests…</p>}
      {interests.isError && (
        <p role="alert">
          Could not load interests. <button onClick={() => interests.refetch()}>Try again</button>
        </p>
      )}
      {interests.data?.length === 0 && (
        <p className="record-muted">Connect this contact to items in your catalog.</p>
      )}
      <ul className="record-related">
        {interests.data?.map(({ id, item }) => (
          <li key={id}>
            <RecordMedia name={item.name} src={item.imageUrl} />
            <button
              className="record-related-name"
              onClick={() => onRelated({ kind: 'inventory', id: item.id, name: item.name })}
            >
              {item.name}
              <small>
                {item.category || item.sku || 'Inventory'} · {priceLabel(item.price)}
              </small>
            </button>
            <button
              aria-label={`Remove interest in ${item.name}`}
              disabled={drop.isPending}
              onClick={() => drop.mutate({ contactId, inventoryId: item.id })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <select
        aria-label="Add inventory interest"
        value=""
        disabled={add.isPending || interests.isLoading || interests.isError}
        onChange={(e) => e.target.value && add.mutate({ contactId, inventoryId: e.target.value })}
      >
        <option value="">Add an item…</option>
        {choices.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      {catalog.hasNextPage && (
        <button disabled={catalog.isFetchingNextPage} onClick={() => catalog.fetchNextPage()}>
          Load more items
        </button>
      )}
      {catalog.isError && (
        <p role="alert">
          Could not load catalog. <button onClick={() => catalog.refetch()}>Try again</button>
        </p>
      )}
      {(add.isError || drop.isError) && (
        <p className="record-error" role="alert">
          Could not update interests. Try again.
        </p>
      )}
    </section>
  )
}
