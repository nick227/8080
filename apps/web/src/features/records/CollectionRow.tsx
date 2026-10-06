import { type MouseEvent } from 'react'
import {
  useUpdateContact,
  useUpdateInventoryItem,
  type Contact,
  type InventoryItem,
  type LeadStatus,
} from '@project/sdk'
import { RecordMedia } from './RecordChrome'
import {
  STAGES,
  contactSubtitle,
  dateLabel,
  followUpLate,
  localDay,
  priceLabel,
  stockLabel,
  titleCase,
} from './labels'
import { useSaveFeedback } from './saveFeedback'

const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey

export function CollectionRow({
  record,
  kind,
  workspaceId,
  currency,
  selected,
  checked,
  href,
  onOpen,
  onPreview,
  onToggle,
}: {
  record: Contact | InventoryItem
  kind: 'contacts' | 'inventory'
  workspaceId: string
  currency: string
  selected: boolean
  checked: boolean
  href: string
  onOpen: (id: string) => void
  onPreview: (id: string, name: string) => void
  onToggle: (id: string) => void
}) {
  const person = 'displayName' in record ? record : null
  const item = !person ? (record as InventoryItem) : null
  const name = person?.displayName ?? item!.name
  const late = person ? followUpLate(person) : false
  return (
    <li className="record-tile" data-selected={selected || undefined}>
      <label className="record-select">
        <input
          type="checkbox"
          checked={checked}
          aria-label={`Select ${name}`}
          onChange={() => onToggle(record.id)}
          onClick={(e) => e.stopPropagation()}
        />
      </label>
      <RecordMedia name={name} src={person?.imageUrl ?? item?.imageUrl} person={!!person} />
      <div className="record-tile-identity">
        <a
          href={href}
          data-record-link={record.id}
          onClick={(event) => {
            if (plainClick(event)) {
              event.preventDefault()
              onOpen(record.id)
            }
          }}
        >
          {name}
        </a>
        <span>{person ? contactSubtitle(person) : item!.category || item!.sku || 'Catalog item'}</span>
      </div>
      {person ? (
        <InlineStage contact={person} workspaceId={workspaceId} />
      ) : (
        <InlineAvailability item={item!} workspaceId={workspaceId} />
      )}
      <span className="record-tile-meta" data-attention={!!late || item?.quantity === 0 || item?.lowStock || undefined}>
        {person ? (
          person.nextFollowUp ? (
            `${late ? 'Overdue · ' : 'Follow-up · '}${dateLabel(person.nextFollowUp)}`
          ) : (
            'No follow-up set'
          )
        ) : (
          <>
            {priceLabel(item!.price, currency)}
            <small>
              {stockLabel(item!)}
              {item!.location ? ` · ${item!.location}` : ''}
            </small>
          </>
        )}
      </span>
      <button
        className="record-preview-button"
        aria-label={`Preview ${name}`}
        aria-pressed={selected}
        onClick={() => onPreview(record.id, name)}
      >
        Preview ↗
      </button>
    </li>
  )
}

function InlineStage({ contact, workspaceId }: { contact: Contact; workspaceId: string }) {
  const update = useUpdateContact(workspaceId)
  const feedback = useSaveFeedback(update.isPending, update.error)
  return (
    <span className="record-tile-state">
      <select
        aria-label={`Stage for ${contact.displayName}`}
        value={contact.leadStatus ?? 'new'}
        disabled={update.isPending}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) =>
          update.mutate({
            contactId: contact.id,
            expectedVersion: contact.version,
            leadStatus: e.target.value as LeadStatus,
          })
        }
      >
        {STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {titleCase(stage)}
          </option>
        ))}
      </select>
      {feedback.label && (
        <small role="status" data-failed={feedback.failed || undefined}>
          {feedback.label}
        </small>
      )}
    </span>
  )
}

function InlineAvailability({ item, workspaceId }: { item: InventoryItem; workspaceId: string }) {
  const update = useUpdateInventoryItem(workspaceId)
  const feedback = useSaveFeedback(update.isPending, update.error)
  return (
    <span className="record-tile-state">
      <select
        aria-label={`Availability for ${item.name}`}
        value={item.availability ? 'offered' : 'paused'}
        disabled={update.isPending}
        onClick={(e) => e.stopPropagation()}
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
        <small role="status" data-failed={feedback.failed || undefined}>
          {feedback.label}
        </small>
      )}
    </span>
  )
}
