import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useContacts, useCreateTaskLink, useDeleteTaskLink, useMyRooms, useTaskLinks } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { roomTitle } from '../../utils/room'
import { useCalendar } from './store'
import type { CalTask } from './types'

// What a task relates to: contacts and conversations. A conversation you can't
// see is listed without its name. Linking is recorded on the task's history.

type Adding = 'contact' | 'conversation' | null

export function TaskLinks({ task }: { task: CalTask }) {
  const { workspace } = useCurrentWorkspace()
  const ws = workspace?.id ?? ''
  const pending = task.pending || task.id.startsWith('tmp-')
  const links = useTaskLinks(ws || undefined, { taskId: pending ? undefined : task.id })
  const create = useCreateTaskLink(ws)
  const remove = useDeleteTaskLink(ws)
  const say = useCalendar((s) => s.say)
  const navigate = useNavigate()
  const location = useLocation()
  const [adding, setAdding] = useState<Adding>(null)
  const [q, setQ] = useState('')
  const contacts = useContacts(adding === 'contact' && ws ? ws : undefined, { q: q.trim() || undefined, limit: 6 })
  const rooms = useMyRooms({ limit: 50 })
  const list = links.data ?? []

  const contactHref = (id: string) => {
    const next = new URLSearchParams(location.search)
    next.set('desk', 'contacts')
    next.set('record', id)
    next.delete('ticket')
    return `?${next.toString()}`
  }
  const link = (body: { contactId?: string; roomId?: string }) =>
    create.mutate({ taskId: task.id, ...body }, {
      onSuccess: () => { setAdding(null); setQ('') },
      onError: (err) => say((err as Error).message || "Couldn't link that."),
    })

  const linkedContacts = new Set(list.map((l) => l.contact?.id).filter(Boolean))
  const linkedRooms = new Set(list.map((l) => l.room?.id).filter(Boolean))
  const contactOptions = (contacts.data?.pages.flatMap((p) => p.data) ?? []).filter((c) => !linkedContacts.has(c.id)).slice(0, 6)
  const needle = q.trim().toLowerCase()
  const roomOptions = (rooms.data?.pages.flatMap((p) => p.data) ?? [])
    .filter((r) => !linkedRooms.has(r.id) && (!needle || roomTitle(r).toLowerCase().includes(needle)))
    .slice(0, 6)

  return (
    <div className="ticket-section">
      <div className="ticket-activity-head">
        <h3 className="ticket-section-heading">Linked</h3>
        {!pending && adding === null && (
          <span className="ticket-link-add">
            <button type="button" className="cal-link-btn" onClick={() => { setAdding('contact'); setQ('') }}>+ Contact</button>
            <button type="button" className="cal-link-btn" onClick={() => { setAdding('conversation'); setQ('') }}>+ Conversation</button>
          </span>
        )}
      </div>
      {list.length > 0 ? (
        <ul className="ticket-links">
          {list.map((l) => (
            <li key={l.id}>
              <span className="ticket-link-kind">{l.kind === 'contact' ? 'Contact' : 'Conversation'}</span>
              {l.contact ? <a className="cal-title-link" href={contactHref(l.contact.id)} onClick={(e) => { e.preventDefault(); navigate({ search: contactHref(l.contact!.id) }) }}>{l.contact.name}</a>
                : l.room ? <a className="cal-title-link" href={`/room/${l.room.id}`} onClick={(e) => { e.preventDefault(); navigate(`/room/${l.room!.id}`) }}>{roomTitle(l.room)}</a>
                  : <span className="ticket-link-hidden">A conversation you can't see</span>}
              <button type="button" className="cal-link-btn" aria-label={`Unlink ${l.contact?.name ?? (l.room ? roomTitle(l.room) : 'conversation')}`} disabled={remove.isPending}
                onClick={() => remove.mutate({ taskId: task.id, linkId: l.id }, { onError: () => say("Couldn't unlink that.") })}>Unlink</button>
            </li>
          ))}
        </ul>
      ) : adding === null && <p className="ticket-links-empty">{pending ? 'Saving…' : 'No contacts or conversations linked.'}</p>}
      {adding && (
        <div className="ticket-link-picker">
          <input autoFocus type="search" aria-label={adding === 'contact' ? 'Find a contact' : 'Find a conversation'}
            placeholder={adding === 'contact' ? 'Find a contact…' : 'Find a conversation…'} value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(null) } }} />
          <ul role="listbox" aria-label={adding === 'contact' ? 'Contacts' : 'Conversations'}>
            {(adding === 'contact' ? contactOptions.map((c) => ({ id: c.id, label: c.displayName })) : roomOptions.map((r) => ({ id: r.id, label: roomTitle(r) }))).map((o) => (
              <li key={o.id}>
                <button type="button" disabled={create.isPending} onClick={() => link(adding === 'contact' ? { contactId: o.id } : { roomId: o.id })}>{o.label}</button>
              </li>
            ))}
          </ul>
          {(adding === 'contact' ? contactOptions : roomOptions).length === 0 && <p className="ticket-links-empty">{adding === 'contact' ? (contacts.isLoading ? 'Searching…' : 'No matching contacts.') : 'No matching conversations.'}</p>}
          <button type="button" className="cal-link-btn" onClick={() => setAdding(null)}>Cancel</button>
        </div>
      )}
    </div>
  )
}
