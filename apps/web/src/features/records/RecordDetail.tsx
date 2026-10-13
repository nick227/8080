import { useEffect, useRef, useState } from 'react'
import {
  useContact,
  useInventoryItem,
  useUpdateContact,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useRecordTimeline,
  useWorkspaceVocabulary,
  useWorkspaceMembers,
  type Contact,
  type InventoryItem,
} from '@project/sdk'
import { RecordMedia } from './RecordChrome'
import { RecordForm } from './RecordForm'
import { StockAdjust } from './StockAdjust'
import { StockHistory } from './StockHistory'
import { RecordGallery } from './RecordGallery'
import { RecordNotes } from './RecordNotes'
import { PencilIcon } from '../../components/icons'
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
  editing,
  onEditing,
}: {
  kind: RecordKind
  id: string
  workspaceId: string
  currency?: string
  onMessage: (id: string) => void
  onDeleted: () => void
  onOpenRecord?: (kind: RecordKind, id: string) => void
  /** Edit as its own page (owned by the URL); without it, edit opens a slide-out. */
  editing?: boolean
  onEditing?: (on: boolean) => void
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
      editingPage={editing}
      onEditing={onEditing}
    />
  ) : (
    <InventoryDetail
      key={id}
      item={item.data!}
      workspaceId={workspaceId}
      currency={currency}
      onDeleted={onDeleted}
      onOpenRecord={onOpenRecord}
      editingPage={editing}
      onEditing={onEditing}
    />
  )
}

function InlineInput({
  value,
  onSave,
  label,
  placeholder = '—',
  type = 'text',
  className = '',
  disabled = false,
  autoFocus = false,
  onBlur,
}: {
  value: string | null | undefined
  onSave: (val: string | null) => void
  label: string
  placeholder?: string
  type?: string
  className?: string
  disabled?: boolean
  autoFocus?: boolean
  onBlur?: () => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const focused = useRef(false)
  const skipBlur = useRef(false)
  const lastSent = useRef(value ?? '')

  useEffect(() => {
    if (!focused.current) {
      setDraft(value ?? '')
      lastSent.current = value ?? ''
    }
  }, [value])

  return (
    <input
      aria-label={label}
      type={type}
      autoFocus={autoFocus}
      value={draft}
      disabled={disabled}
      className={`record-inline-input ${className}`.trim()}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={(e) => {
        focused.current = false
        if (!skipBlur.current && draft.trim() !== lastSent.current) {
          lastSent.current = draft.trim()
          onSave(draft.trim() || null)
        }
        skipBlur.current = false
        onBlur?.()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          skipBlur.current = true
          setDraft(value ?? '')
          lastSent.current = value ?? ''
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function ContactDetail({
  contact: c,
  workspaceId,
  currency,
  onMessage,
  onOpenRecord,
  editingPage,
  onEditing,
}: {
  contact: Contact
  workspaceId: string
  currency: string
  onMessage: (id: string) => void
  onOpenRecord?: (kind: RecordKind, id: string) => void
  editingPage?: boolean
  onEditing?: (on: boolean) => void
}) {
  const update = useUpdateContact(workspaceId)
  const feedback = useSaveFeedback(update.isPending, update.error)
  const vocabulary = useWorkspaceVocabulary(workspaceId)
  const membersQuery = useWorkspaceMembers(workspaceId)
  const [editingName, setEditingName] = useState(false)

  // Clear edit URL flag if navigating directly with edit=1 since contact editing is always inline
  useEffect(() => {
    if (editingPage && onEditing) onEditing(false)
  }, [editingPage, onEditing])

  const stages = (vocabulary.data?.stages ?? []).filter((s) => !s.archived)
  const stageOptions = stages.length ? stages : STAGES.map((key) => ({ key, label: titleCase(key) }))
  const members = (membersQuery.data ?? []).filter((m) => m.status === 'active' || m.id === c.ownerMemberId)
  const isLost = Boolean(
    c.fieldValues?.lost === true ||
    c.leadStatus === 'lost' ||
    stages.some((s) => s.key === c.leadStatus && s.kind === 'lost'),
  )

  const change = (data: Partial<Parameters<typeof update.mutate>[0]>) =>
    update.mutate({ contactId: c.id, expectedVersion: c.version, ...data })

  const updateEmail = (email: string | null) => {
    const otherPoints = (c.points ?? []).filter((p) => p.kind !== 'email')
    const newPoints = [
      ...(email ? [{ kind: 'email' as const, value: email, isPrimary: true }] : []),
      ...otherPoints.map((p) => ({
        kind: p.kind,
        value: p.value,
        label: p.label,
        isPrimary: p.isPrimary,
        shared: p.shared,
      })),
    ]
    change({ points: newPoints })
  }

  const updatePhone = (phone: string | null) => {
    const otherPoints = (c.points ?? []).filter((p) => p.kind !== 'phone')
    const newPoints = [
      ...(phone ? [{ kind: 'phone' as const, value: phone, isPrimary: true }] : []),
      ...otherPoints.map((p) => ({
        kind: p.kind,
        value: p.value,
        label: p.label,
        isPrimary: p.isPrimary,
        shared: p.shared,
      })),
    ]
    change({ points: newPoints })
  }

  return (
    <article className="record-detail record-detail-simplified">
      {/* 5 Checkbox states at top of page: Contacted, Qualified, Proposed, Won, Lost */}
      <div className="record-milestones-bar" role="group" aria-label="Lead milestone states">
        <label className="record-milestone-pill" data-checked={c.contacted || undefined}>
          <input
            type="checkbox"
            checked={!!c.contacted}
            disabled={update.isPending}
            onChange={(e) => change({ contacted: e.target.checked })}
          />
          <span className="record-milestone-check">✓</span>
          <span className="record-milestone-label">Contacted</span>
        </label>
        <label className="record-milestone-pill" data-checked={c.qualified || undefined}>
          <input
            type="checkbox"
            checked={!!c.qualified}
            disabled={update.isPending}
            onChange={(e) => change({ qualified: e.target.checked })}
          />
          <span className="record-milestone-check">✓</span>
          <span className="record-milestone-label">Qualified</span>
        </label>
        <label className="record-milestone-pill" data-checked={c.proposalSent || undefined}>
          <input
            type="checkbox"
            checked={!!c.proposalSent}
            disabled={update.isPending}
            onChange={(e) => change({ proposalSent: e.target.checked })}
          />
          <span className="record-milestone-check">✓</span>
          <span className="record-milestone-label">Proposed</span>
        </label>
        <label className="record-milestone-pill record-milestone-won" data-checked={c.won || undefined}>
          <input
            type="checkbox"
            checked={!!c.won}
            disabled={update.isPending}
            onChange={(e) =>
              change({
                won: e.target.checked,
                ...(e.target.checked ? { fieldValues: { lost: false } } : {}),
              })
            }
          />
          <span className="record-milestone-check">★</span>
          <span className="record-milestone-label">Won</span>
        </label>
        <label className="record-milestone-pill record-milestone-lost" data-checked={isLost || undefined}>
          <input
            type="checkbox"
            checked={isLost}
            disabled={update.isPending}
            onChange={(e) =>
              change({
                fieldValues: { lost: e.target.checked },
                ...(e.target.checked ? { won: false } : {}),
              })
            }
          />
          <span className="record-milestone-check">✕</span>
          <span className="record-milestone-label">Lost</span>
        </label>
      </div>

      {/* Header combined with properties and inline editing */}
      <header className="record-masthead record-header-combined">
        <div className="record-header-top">
          <RecordMedia name={c.displayName} src={c.imageUrl} person />
          <div className="record-identity">
            <span className="record-eyebrow">
              Contact{c.status === 'archived' && ' · Archived'}
            </span>

            <div className="record-identity-heading-wrap">
              <h1 className="record-identity-heading">
                {editingName ? (
                  <InlineInput
                    autoFocus
                    label="Contact name"
                    value={c.displayName}
                    onSave={(val) => {
                      if (val) change({ displayName: val })
                      setEditingName(false)
                    }}
                    onBlur={() => setEditingName(false)}
                    className="record-name-input"
                    disabled={update.isPending}
                  />
                ) : (
                  <span
                    className="record-name-display"
                    onClick={() => setEditingName(true)}
                    title="Click to edit name"
                  >
                    {c.displayName}
                    <button
                      type="button"
                      className="record-inline-edit-btn"
                      aria-label="Edit name"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingName(true)
                      }}
                    >
                      <PencilIcon />
                    </button>
                  </span>
                )}
              </h1>
            </div>

            <div className="record-subtitle-row">
              <InlineInput
                label="Role or title"
                placeholder="Add role or title…"
                value={c.title}
                onSave={(val) => change({ title: val })}
                className="record-title-input"
                disabled={update.isPending}
              />
              {c.accounts?.[0]?.name && (
                <span className="record-subtitle-company">· {c.accounts[0].name}</span>
              )}
            </div>

            <div className="record-actions">
              <button className="record-primary" onClick={() => onMessage(c.id)}>
                Message
              </button>
              <button
                disabled={update.isPending}
                onClick={() =>
                  change({ status: c.status === 'archived' ? 'active' : 'archived' })
                }
              >
                {c.status === 'archived' ? 'Restore' : 'Archive'}
              </button>
            </div>
          </div>
        </div>

        {/* Combined Properties Grid */}
        <div className="record-header-props">
          <div className="record-prop-item">
            <span className="record-prop-label">Email</span>
            <div className="record-prop-control">
              <InlineInput
                label="Primary email"
                type="email"
                placeholder="Add email…"
                value={c.primaryEmail}
                onSave={updateEmail}
                disabled={update.isPending}
              />
              {c.primaryEmail && (
                <a
                  href={`mailto:${c.primaryEmail}`}
                  className="record-prop-link"
                  title={`Email ${c.primaryEmail}`}
                  tabIndex={-1}
                >
                  ✉
                </a>
              )}
            </div>
          </div>

          <div className="record-prop-item">
            <span className="record-prop-label">Phone</span>
            <div className="record-prop-control">
              <InlineInput
                label="Primary phone"
                type="tel"
                placeholder="Add phone…"
                value={c.primaryPhone}
                onSave={updatePhone}
                disabled={update.isPending}
              />
              {c.primaryPhone && (
                <a
                  href={`tel:${c.primaryPhone}`}
                  className="record-prop-link"
                  title={`Call ${c.primaryPhone}`}
                  tabIndex={-1}
                >
                  📞
                </a>
              )}
            </div>
          </div>

          <div className="record-prop-item">
            <span className="record-prop-label">Stage</span>
            <div className="record-prop-control">
              <select
                aria-label="Lead stage"
                value={c.leadStatus ?? 'new'}
                disabled={update.isPending}
                onChange={(e) => change({ leadStatus: e.target.value })}
              >
                {stageOptions.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="record-prop-item">
            <span className="record-prop-label">Next Follow-up</span>
            <div className="record-prop-control">
              <input
                aria-label="Next follow-up"
                type="date"
                value={localDay(c.nextFollowUp)}
                disabled={update.isPending}
                onChange={(e) =>
                  change({
                    nextFollowUp: e.target.value
                      ? new Date(`${e.target.value}T09:00:00`).toISOString()
                      : null,
                  })
                }
              />
            </div>
          </div>

          <div className="record-prop-item">
            <span className="record-prop-label">Owner</span>
            <div className="record-prop-control">
              <select
                aria-label="Owner"
                value={c.ownerMemberId ?? ''}
                disabled={update.isPending}
                onChange={(e) => change({ ownerMemberId: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="record-prop-item">
            <span className="record-prop-label">Source</span>
            <div className="record-prop-control">
              <InlineInput
                label="Lead source"
                placeholder="Add source…"
                value={c.leadSource}
                onSave={(val) => change({ leadSource: val })}
                disabled={update.isPending}
              />
            </div>
          </div>
        </div>

        {/* Flat metadata footer with dates and save status */}
        <div className="record-header-meta">
          <span>Created {dateLabel(c.createdAt)}</span>
          <span>Updated {dateLabel(c.updatedAt)}</span>
          <span>Last activity {dateLabel(c.lastActivityAt)}</span>
          {feedback.label && (
            <span
              className="record-save-status"
              data-failed={feedback.failed || undefined}
              role="status"
            >
              {feedback.label}
            </span>
          )}
        </div>
      </header>

      {feedback.failed && (
        <p role="alert" className="record-error">
          {feedback.label}
        </p>
      )}

      {/* Main body: notes and activity on left, compact images on right */}
      <div className="record-body">

        
          <RecordGallery
            workspaceId={workspaceId}
            kind="contacts"
            recordId={c.id}
            name={c.displayName}
          />

        <div className="record-main">
          <RecordNotes
            workspaceId={workspaceId}
            subject={{ contactId: c.id }}
            recordName={c.displayName}
          />
          
          <section className="record-activity">
            <Activity workspaceId={workspaceId} contactId={c.id} />
          </section>
        </div>
      </div>
    </article>
  )
}

function InventoryDetail({
  item,
  workspaceId,
  currency,
  onDeleted,
  onOpenRecord,
  editingPage,
  onEditing,
}: {
  item: InventoryItem
  workspaceId: string
  currency: string
  onDeleted: () => void
  onOpenRecord?: (kind: RecordKind, id: string) => void
  editingPage?: boolean
  onEditing?: (on: boolean) => void
}) {
  const update = useUpdateInventoryItem(workspaceId)
  const remove = useDeleteInventoryItem(workspaceId)
  const feedback = useSaveFeedback(update.isPending, update.error ?? remove.error)
  const [localEditing, setLocalEditing] = useState(false)
  const editing = onEditing ? !!editingPage : localEditing
  const setEditing = onEditing ?? setLocalEditing
  const [adjusting, setAdjusting] = useState(false)
  const tracked = item.quantity != null
  if (editing && onEditing) {
    return (
      <RecordForm page={{ backLabel: item.name }} kind="inventory" workspaceId={workspaceId} currency={currency} item={item}
        onClose={() => setEditing(false)} onSaved={() => setEditing(false)} onOpenRecord={onOpenRecord} />
    )
  }
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
      {editing && !onEditing && (
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
    <div className="record-dates-flat">
      <div className="record-date-item">
        <span className="record-prop-label">Created</span>
        <span>{dateLabel(created)}</span>
      </div>
      <div className="record-date-item">
        <span className="record-prop-label">Updated</span>
        <span>{dateLabel(updated)}</span>
      </div>
    </div>
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
