import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Room } from '@project/sdk'
import { formatAgo, formatDay, formatLength } from '../../utils/time'
import { pictureOf } from '../../utils/thumbnail'

// One conversation in the Lobby: thumbnail, name, description, meta. Nothing plays
// here — media lives inside the conversation.
export function ConversationCard({ room, action }: { room: Room; action?: ReactNode }) {
  const [broken, setBroken] = useState(false)
  const picture = pictureOf(room.thumbnail)
  const responses = room.responseCount === 1 ? '1 RESPONSE' : room.responseCount ? `${room.responseCount} RESPONSES` : 'NO RESPONSES YET'
  const meta = [
    responses,
    room.durationMs > 0 ? formatLength(room.durationMs) : null,
    `STARTED ${formatDay(room.createdAt)}`,
    room.lastResponseAt ? `LAST ${formatAgo(room.lastResponseAt)}` : null,
    room.visibility === 'private' ? 'PRIVATE' : null,
  ].filter(Boolean)

  return (
    <div className="conv-card" data-room-id={room.id}>
      <Link className="conv-card-link" to={`/room/${room.id}`}>
        <span className="conv-card-thumb">
          {picture && !broken ? (
            <img src={picture} alt="" loading="lazy" onError={() => setBroken(true)} />
          ) : (
            <span className="conv-card-thumb-fallback">{String(room.number).padStart(3, '0')}</span>
          )}
        </span>
        <span className="conv-card-title">{room.title}</span>
        {room.description && <span className="conv-card-desc">{room.description}</span>}
      </Link>
      <span className="conv-card-meta">
        <span>{meta.join(' · ')}</span>
        {action}
      </span>
    </div>
  )
}
