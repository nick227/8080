import { useState } from 'react'
import {
  useContact,
  useInventoryItem,
  useUpdateContact,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useRecordTimeline,
  useWorkspaceVocabulary,
  type Contact,
  type InventoryItem,
} from '@project/sdk'
import { RecordMedia } from './RecordChrome'
import { RecordForm } from './RecordForm'
import { StockAdjust } from './StockAdjust'
import { StockHistory } from './StockHistory'
import { RecordGallery } from './RecordGallery'
import { RecordNotes } from './RecordNotes'
import { ContactBrief } from './ContactBrief'
import {
  STAGES,
  contactSubtitle,
  dateLabel,
  localDay,
  priceLabel,
  stockLabel,
  titleCase,
} from './labels'
import { useSaveFeedback } from './saveFeedback'
import type { RecordKind } from './navigation'

export {
  STAGES,
  contactSubtitle,
  dateLabel,
  localDay,
  priceLabel,
  stockLabel,
  titleCase,
} from './labels'

export function RecordDetail({
  kind,
  id,
  workspaceId,
  currency = 'USD',
  onMessage,
  onDeleted,
  onOpenRecord,
}: {
  kind: RecordKind
  id: string
  workspaceId: string
  currency?: string
  onMessage: (id: string) => void
  onDeleted: () => void
  onOpenRecord?: (kind: RecordKind, id: string) => void
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
      currency={currency}
      onMessage={onMessage}
      onOpenRecord={onOpenRecord}
    />
  ) : (
    <InventoryDetail
      key={id}
      item={item.data!}
      workspaceId={workspaceId}
      currency={currency}
      onDeleted={onDeleted}
      onOpenRecord={onOpenRecord}
    />
  )
}

function ContactDetail({
  contact: c,
  workspaceId,
  currency,
  onMessage,
  onOpenRecord,
}: {
  contact: Contact
  workspaceId: string
  currency: string
  onMessage: (id: string) => void
  onOpenRecord?: (kind: RecordKind, id: string) => void
}) {
  const update = useUpdateContact(workspaceId)
  const feedback = useSaveFeedback(update.isPending, update.error)
  const vocabulary = useWorkspaceVocabulary(workspaceId)
  const stages = (vocabulary.data?.stages ?? []).filter((s) => !s.archived)
  const stageOptions = stages.length ? stages : STAGES.map((key) => ({ key, label: titleCase(key) }))
  const [editing, setEditing] = useState(false)
  const change = (data: Parameters<typeof update.mutate>[0]) =>
    update.mutate({ expectedVersion: c.version, ...data })
  return (
    <article className="record-detail">
      <header className="record-masthead">
        <RecordMedia name={c.displayName} src={c.imageUrl} person />
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
            onChange={(e) => change({ contactId: c.id, leadStatus: e.target.value })}
          >
            {stageOptions.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
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
        <span role="status" data-failed={feedback.failed || undefined}>
          {feedback.label ||
            (c.nextFollowUp ? dateLabel(c.nextFollowUp) : 'Set the next step for this relationship')}
        </span>
      </div>
      {feedback.failed && (
        <p role="alert" className="record-error">
          {feedback.label}
        </p>
      )}
      <div className="record-body">
        <div className="record-main">
          <RecordNotes workspaceId={workspaceId} subject={{ contactId: c.id }} recordName={c.displayName} />
          <ContactBrief workspaceId={workspaceId} contactId={c.id} />
          <RecordGallery workspaceId={workspaceId} kind="contacts" recordId={c.id} name={c.displayName} />
          <section>
            <h2>Recent activity</h2>
            <Activity workspaceId={workspaceId} contactId={c.id} />
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
      {editing && (
        <RecordForm
          kind="contacts"
          workspaceId={workspaceId}
          currency={currency}
          contact={c}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
          onOpenRecord={onOpenRecord}
        />
      )}
    </article>
  )
}

function InventoryDetail({
  item,
  workspaceId,
  currency,
  onDeleted,
  onOpenRecord,
}: {
  item: InventoryItem
  workspaceId: string
  currency: string
  onDeleted: () => void
  onOpenRecord?: (kind: RecordKind, id: string) => void
}) {
  const update = useUpdateInventoryItem(workspaceId)
  const remove = useDeleteInventoryItem(workspaceId)
  const feedback = useSaveFeedback(update.isPending, update.error ?? remove.error)
  const [editing, setEditing] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const tracked = item.quantity != null
  return (
    <article className="record-detail">
      <header className="record-masthead">
        <RecordMedia name={item.name} src={item.imageUrl} />
        <div className="record-identity">
          <span className="record-eyebrow">Inventory{item.status === 'archived' && ' · Archived'}</span>
          <h1>{item.name}</h1>
          <p>{[item.category, item.sku].filter(Boolean).join(' · ') || 'Catalog item'}</p>
          <div className="record-actions">
            <button
              className="record-primary"
              onClick={() => (tracked ? setAdjusting(true) : setEditing(true))}
            >
              {tracked ? 'Adjust stock' : 'Edit item'}
            </button>
            {tracked && <button onClick={() => setEditing(true)}>Edit</button>}
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
        </label>
      </header>
      <div className="record-attention">
        <strong>{stockLabel(item)}</strong>
        <span role="status" data-failed={feedback.failed || undefined}>
          {feedback.label ||
            (item.location ? `${item.location} · ` : '') +
              (item.availability ? 'Offered in your catalog' : 'Offering paused')}
        </span>
      </div>
      {feedback.failed && (
        <p className="record-error" role="alert">
          {feedback.label}
        </p>
      )}
      <div className="record-body">
        <div className="record-main">
          <RecordNotes workspaceId={workspaceId} subject={{ inventoryId: item.id }} recordName={item.name} />
          <RecordGallery workspaceId={workspaceId} kind="inventory" recordId={item.id} name={item.name} />
          <section>
            <h2>Description</h2>
            <p className="record-description">
              {item.description || 'Add a description to help your team understand this item.'}
            </p>
          </section>
          {tracked && <StockHistory workspaceId={workspaceId} inventoryId={item.id} />}
        </div>
        <aside className="record-properties">
          <h2>Properties</h2>
          <dl>
            <dt>Price</dt>
            <dd className="record-price">{priceLabel(item.price, currency)}</dd>
            <dt>Category</dt>
            <dd>{item.category || 'Not set'}</dd>
            <dt>SKU</dt>
            <dd>{item.sku || 'Not set'}</dd>
            <dt>Stock</dt>
            <dd>{stockLabel(item)}</dd>
            {tracked && (
              <>
                <dt>Low-stock at</dt>
                <dd>{item.lowStockThreshold ?? 'Not set'}</dd>
                <dt>Location</dt>
                <dd>{item.location || 'Not set'}</dd>
              </>
            )}
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
          currency={currency}
          item={item}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
          onOpenRecord={onOpenRecord}
        />
      )}
      {adjusting && <StockAdjust item={item} workspaceId={workspaceId} onClose={() => setAdjusting(false)} />}
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
}: {
  workspaceId: string
  contactId: string
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
          {entries.map((entry) => (
            <li key={entry.id}>
              <span>{titleCase(entry.type.replace(/[._]/g, ' '))}</span>
              <small>
                {entry.actor?.name ?? 'System'} · {dateLabel(entry.occurredAt)}
              </small>
            </li>
          ))}
        </ol>
      )}
      {timeline.hasNextPage && (
        <button disabled={timeline.isFetchingNextPage} onClick={() => timeline.fetchNextPage()}>
          Show more activity
        </button>
      )}
    </div>
  )
}
