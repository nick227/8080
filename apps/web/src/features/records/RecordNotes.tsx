import { useState } from 'react'
import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useSession,
  type Subject,
} from '@project/sdk'
import { dateLabel } from './labels'

type Props = {
  workspaceId: string
  subject: Subject
  recordName: string
}

export function RecordNotes({ workspaceId, subject, recordName }: Props) {
  const session = useSession()
  const notes = useNotes(workspaceId, subject)
  const create = useCreateNote(workspaceId)
  const remove = useDeleteNote(workspaceId)
  const [text, setText] = useState('')
  const rows = notes.data?.pages.flatMap((page) => page.data) ?? []
  const busy = create.isPending || remove.isPending
  const myId = session.data?.data.id

  const submit = async () => {
    const body = text.trim()
    if (!body || busy) return
    const payload =
      'contactId' in subject
        ? { text: body, contactIds: [subject.contactId] }
        : 'accountId' in subject
          ? { text: body, accountIds: [subject.accountId] }
          : { text: body, inventoryIds: [subject.inventoryId] }
    await create.mutateAsync(payload)
    setText('')
  }

  return (
    <section className="record-notes" aria-label={`Notes on ${recordName}`}>
      <h2>Notes</h2>
      <form
        className="record-notes-compose"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a running note"
          rows={3}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !text.trim()}>
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>
      {create.isError && (
        <p className="record-error" role="alert">
          Couldn’t add the note. Try again.
        </p>
      )}
      {rows.length === 0 && !notes.isLoading ? (
        <p className="record-notes-empty">Add a running note</p>
      ) : (
        <ul className="record-notes-list">
          {rows.map((note) => (
            <li key={note.id}>
              <header>
                <strong>{note.author.name}</strong>
                <time dateTime={note.createdAt}>{dateLabel(note.createdAt)}</time>
                {myId === note.author.id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove.mutateAsync(note.id)}
                  >
                    Delete
                  </button>
                )}
              </header>
              <p>{note.contentRemoved ? 'Content removed' : note.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
