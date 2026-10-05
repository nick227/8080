import { useState } from 'react'
import { useContacts } from '@project/sdk'
import { Composer } from '../compose/Composer'
import { useCurrentWorkspace } from '../documents/workspace'

export function ContactsDesk() {
  const { workspace, loading } = useCurrentWorkspace()
  const list = useContacts(workspace?.id)
  const [contactId, setContactId] = useState<string | null>(null)
  const people = list.data?.pages.flatMap((page) => page.data) ?? []

  if (loading) return null
  if (!workspace || people.length === 0) return <p className="work-empty">No one saved yet.</p>

  return (
    <div className="work-frame">
      {contactId && (
        <Composer workspaceId={workspace.id} contactId={contactId} contextType="contact" contextId={contactId} onClose={() => setContactId(null)} />
      )}
      <ul className="work-lines">
        {people.map((person) => (
          <li key={person.id} className="work-line" data-compact="">
            <span className="work-line-title">{person.displayName}</span>
            <button type="button" onClick={() => setContactId(person.id)}>Message</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
