import { useState } from 'react'
import type { Participant } from '@project/sdk'
import type { Item } from '../../api/types'
import { nameWithTag } from '../../components/PersonName'

export type PresenceActivity = 'here' | 'typing' | 'recording'

export type RoomPerson = {
  id: string
  name: string
  tag?: string
  avatarUrl?: string
  activity: PresenceActivity | null
}

// Who holds a seat. With the live roster (doc/08 §2.3): whoever is present now —
// people and seated bots alike, so a participant is seated before speaking and
// leaves the seats when they go (or are removed). Items only refresh names and
// avatars. Until the roster loads: everyone who has spoken (the old rule).
// No kind checks: the roster decides.
export function roomPeopleFrom(
  items: Item[],
  meId: string | undefined,
  meName: string,
  meAvatar: string | undefined,
  activity: PresenceActivity,
  participants?: Participant[],
): RoomPerson[] {
  const seen = new Map<string, { name: string; tag?: string; avatarUrl?: string }>()
  if (participants) {
    for (const p of participants) {
      if (p.present) seen.set(p.user.id, { name: p.user.name, tag: p.user.tag ?? undefined, avatarUrl: p.user.avatarUrl ?? undefined })
    }
  }
  for (const item of items) {
    const prev = seen.get(item.author.id)
    if (participants && !prev) continue
    seen.set(item.author.id, { name: item.author.name, tag: item.author.tag ?? prev?.tag, avatarUrl: item.author.avatarUrl ?? prev?.avatarUrl })
  }
  if (meId) {
    const prev = seen.get(meId)
    seen.set(meId, { name: meName, avatarUrl: meAvatar ?? prev?.avatarUrl })
  }
  return [...seen].map(([id, person]) => ({
    id,
    name: person.name,
    tag: person.tag,
    avatarUrl: person.avatarUrl,
    activity: id === meId ? activity : null,
  }))
}

const mark = (name: string) => (name.trim().charAt(0) || '?').toUpperCase()

function label(person: RoomPerson, meId: string | undefined) {
  const name = person.id === meId ? 'You' : nameWithTag(person.name, person.tag)
  if (person.activity === 'recording') return `${name}, recording`
  if (person.activity === 'typing') return `${name}, typing`
  return name
}

export function PeopleStrip({ people, meId, inviteUrl, faces = true }: {
  people: RoomPerson[]
  meId?: string
  inviteUrl?: string
  faces?: boolean
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const shown = people.slice(0, 5)
  const extra = people.length - shown.length

  return (
    <div className="room-people">
      <div className="room-discs" role="list" aria-label="People in this room">
        {faces && shown.map((person) => (
          <span key={person.id} role="listitem" className="room-person" aria-label={label(person, meId)}>
            <span
              className="room-disc"
              data-activity={person.activity ?? undefined}
              data-photo={person.avatarUrl ? '' : undefined}
              aria-hidden
            >
              {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : mark(person.name)}
            </span>
          </span>
        ))}
        {faces && extra > 0 && (
          <span className="room-person" role="listitem" aria-label={`${extra} more`}>
            <span className="room-disc" aria-hidden>+{extra}</span>
          </span>
        )}
        <button type="button" className="room-person room-invite" aria-label="Copy invite link" onClick={() => void copy()}>
          <span className="room-disc" aria-hidden>+</span>
          <span className="room-person-name">{copied ? 'Copied' : 'Invite'}</span>
        </button>
      </div>
    </div>
  )
}
