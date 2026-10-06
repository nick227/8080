import { useState, type FormEvent } from 'react'
import {
  useAddContactInterest,
  useContactInterests,
  useContacts,
  useCreateContact,
  useInventory,
  useRemoveContactInterest,
  useUpdateContact,
  type Contact,
  type LeadStatus,
} from '@project/sdk'
import { Composer } from '../compose/Composer'
import { useCurrentWorkspace } from '../documents/workspace'
import '../work/work.css'
import '../inventory/desks.css'

const STAGES: { id: LeadStatus; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'contacting', label: 'Contacting' },
  { id: 'connected', label: 'Connected' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'customer', label: 'Customer' },
  { id: 'lost', label: 'Lost' },
]

const day = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const today = () => day(new Date().toISOString())
// A follow-up is late when its day has passed and the person is still being worked.
const isLate = (c: Contact) => !!c.nextFollowUp && day(c.nextFollowUp) < today() && c.leadStatus !== 'customer' && c.leadStatus !== 'lost'

export function ContactsDesk() {
  const { workspace, loading } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ''
  const [filter, setFilter] = useState('')
  const [stage, setStage] = useState<LeadStatus | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [messageId, setMessageId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const list = useContacts(workspace?.id, { q: filter.trim() || undefined })
  const create = useCreateContact(workspaceId)
  const update = useUpdateContact(workspaceId)
  const everyone = list.data?.pages.flatMap((page) => page.data) ?? []
  const people = stage ? everyone.filter((c) => c.leadStatus === stage) : everyone
  const counts = new Map<string, number>()
  for (const c of everyone) counts.set(c.leadStatus ?? 'new', (counts.get(c.leadStatus ?? 'new') ?? 0) + 1)

  if (loading || !workspace) return null

  const add = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Add a name.')
    create.mutate(
      { displayName: name.trim(), leadSource: source.trim() || null },
      { onSuccess: () => { setName(''); setSource(''); setAdding(false) }, onError: () => setError('Could not save. Try again.') },
    )
  }

  return (
    <div className="work-frame desk" aria-label="Contacts">
      {messageId && <Composer workspaceId={workspace.id} contactId={messageId} contextType="contact" contextId={messageId} onClose={() => setMessageId(null)} />}

      <div className="work-bar desk-bar">
        <input className="work-filter" type="search" placeholder="Find someone" aria-label="Find someone" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" aria-pressed={stage === null} onClick={() => setStage(null)}>All {everyone.length}</button>
        {STAGES.map((s) => (
          <button key={s.id} type="button" aria-pressed={stage === s.id} onClick={() => setStage(stage === s.id ? null : s.id)}>
            {s.label} {counts.get(s.id) ?? 0}
          </button>
        ))}
        <span className="desk-spacer" />
        <button type="button" className="work-add" onClick={() => setAdding(!adding)} aria-expanded={adding}>{adding ? 'Close' : 'Add someone'}</button>
      </div>

      {adding && (
        <form className="work-fields desk-form" onSubmit={add}>
          <label className="work-field"><span>Name</span><input autoFocus required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="work-field"><span>Where they came from</span><input maxLength={80} value={source} onChange={(e) => setSource(e.target.value)} /></label>
          <button type="submit" disabled={create.isPending}>Save</button>
          {error && <p className="work-compose-error" role="alert">{error}</p>}
        </form>
      )}

      {people.length === 0 ? (
        <p className="work-quiet">{list.isLoading ? 'Loading…' : everyone.length === 0 && !filter ? 'No one saved yet.' : 'No one here.'}</p>
      ) : (
        <ul className="work-lines">
          {people.map((person) => (
            <li key={person.id}>
              <div className="work-line desk-line desk-lead" data-late={isLate(person) ? '' : undefined}>
                <button type="button" className="work-line-title desk-lead-name" aria-expanded={openId === person.id} onClick={() => setOpenId(openId === person.id ? null : person.id)}>
                  {person.displayName}
                </button>
                <select
                  aria-label={`Stage for ${person.displayName}`}
                  value={person.leadStatus ?? 'new'}
                  onChange={(e) => update.mutate({ contactId: person.id, leadStatus: e.target.value as LeadStatus })}
                >
                  {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <input
                  type="date"
                  aria-label={`Follow up with ${person.displayName}`}
                  value={day(person.nextFollowUp)}
                  onChange={(e) => update.mutate({ contactId: person.id, nextFollowUp: e.target.value ? new Date(`${e.target.value}T09:00:00`).toISOString() : null })}
                />
                <span className="work-who">{person.leadSource ?? ''}</span>
                <span className="desk-actions">
                  <button type="button" onClick={() => setMessageId(person.id)}>Message</button>
                </span>
              </div>
              {openId === person.id && <Interests workspaceId={workspace.id} contactId={person.id} />}
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && <button type="button" className="desk-more" onClick={() => list.fetchNextPage()}>Show more</button>}
    </div>
  )
}

// What this person wants from the catalog.
function Interests({ workspaceId, contactId }: { workspaceId: string; contactId: string }) {
  const interests = useContactInterests(workspaceId, contactId)
  const catalog = useInventory(workspaceId)
  const add = useAddContactInterest(workspaceId)
  const drop = useRemoveContactInterest(workspaceId)
  const chosen = new Set(interests.data?.map((i) => i.item.id))
  const choices = (catalog.data?.pages.flatMap((p) => p.data) ?? []).filter((item) => !chosen.has(item.id))

  return (
    <div className="desk-panel">
      <span className="desk-panel-label">Interested in</span>
      {interests.data?.map((i) => (
        <span key={i.id} className="desk-chip">
          {i.item.name}
          <button type="button" aria-label={`Remove ${i.item.name}`} onClick={() => drop.mutate({ contactId, inventoryId: i.item.id })}>Remove</button>
        </span>
      ))}
      {interests.data?.length === 0 && <span className="work-quiet" style={{ margin: 0 }}>Nothing yet.</span>}
      {choices.length > 0 && (
        <select aria-label="Add an item" value="" onChange={(e) => e.target.value && add.mutate({ contactId, inventoryId: e.target.value })}>
          <option value="">Add an item…</option>
          {choices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      )}
    </div>
  )
}
