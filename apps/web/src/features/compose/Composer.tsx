import { useEffect, useState } from 'react'
import { ApiError, useContact, useContacts, useSendCompose } from '@project/sdk'

type Props = {
  workspaceId: string
  contactId?: string
  contextType: string
  contextId: string
  onClose: () => void
}

export function Composer({ workspaceId, contactId, contextType, contextId, onClose }: Props) {
  const preset = useContact(workspaceId, contactId)
  const [query, setQuery] = useState('')
  const [chosenId, setChosenId] = useState(contactId ?? '')
  const [destination, setDestination] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const found = useContacts(workspaceId, query ? { q: query } : {})
  const send = useSendCompose(workspaceId)
  const people = found.data?.pages.flatMap((page) => page.data) ?? []

  useEffect(() => {
    const email = preset.data?.primaryEmail
    if (email) setDestination((current) => current || email)
  }, [preset.data])

  const submit = () => {
    if (!chosenId) return
    send.mutate(
      { contactId: chosenId, channel: 'email', destination, subject, body, contextType, contextId },
      { onSuccess: onClose },
    )
  }

  return (
    <form className="work-compose" onSubmit={(event) => { event.preventDefault(); submit() }}>
      <div className="work-bar">
        <span>Follow up</span>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {contactId ? null : (
        <label className="work-field">
          <span>Contact</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a contact" />
          {people.length > 0 && (
            <ul className="work-lines">
              {people.slice(0, 5).map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    className="work-line"
                    data-compact=""
                    aria-pressed={chosenId === person.id}
                    onClick={() => {
                      setChosenId(person.id)
                      setQuery(person.displayName)
                      if (person.primaryEmail) setDestination(person.primaryEmail)
                    }}
                  >
                    <span className="work-line-title">{person.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
      )}
      <label className="work-field">
        <span>To</span>
        <input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="name@example.com" autoComplete="email" />
      </label>
      <label className="work-field">
        <span>Subject</span>
        <input value={subject} onChange={(event) => setSubject(event.target.value)} />
      </label>
      <label className="work-field">
        <span>Message</span>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} />
      </label>
      {send.error instanceof ApiError && <p className="work-compose-error">{send.error.message}</p>}
      <div className="work-adds">
        <button type="submit" className="work-add" disabled={send.isPending || !chosenId || !destination || !subject || !body}>Send</button>
      </div>
    </form>
  )
}
