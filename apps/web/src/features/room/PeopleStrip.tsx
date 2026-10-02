import { useState } from 'react'

export type PresenceActivity = 'here' | 'typing' | 'recording'

export type RoomPerson = {
  id: string
  name: string
  activity: PresenceActivity | null
}

const mark = (name: string) => (name.trim().charAt(0) || '?').toUpperCase()

function label(person: RoomPerson, meId: string | undefined) {
  const name = person.id === meId ? 'You' : person.name
  if (person.activity === 'recording') return `${name}, recording`
  if (person.activity === 'typing') return `${name}, typing`
  return name
}

export function PeopleStrip({ people, meId, inviteUrl }: {
  people: RoomPerson[]
  meId?: string
  inviteUrl?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="room-people">
      <div className="room-discs" role="list" aria-label="People in this room">
        {people.map((person) => (
          <span key={person.id} role="listitem" className="room-person">
            <span className="room-disc" data-activity={person.activity ?? undefined} aria-hidden>
              {mark(person.name)}
            </span>
            <span className="room-person-name">{label(person, meId)}</span>
          </span>
        ))}
        <button type="button" className="room-person room-invite" aria-label="Copy invite link" onClick={() => void copy()}>
          <span className="room-disc" aria-hidden>+</span>
          <span className="room-person-name">{copied ? 'Copied' : 'Invite'}</span>
        </button>
      </div>
    </div>
  )
}
