import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Room } from '@project/sdk'
import { formatAgo, formatDay, formatLength } from '../../utils/time'
import { pictureOf } from '../../utils/thumbnail'
import { roomTitle } from '../../utils/room'

// One conversation in the Lobby: thumbnail, name, description, meta. Nothing plays
// here — media lives inside the conversation.
/** `title`/`description` replace the room's own (e.g. the company channel's card). */
export function ConversationCard({ room, action, title, description }: { room: Room; action?: ReactNode; title?: string; description?: string }) {
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
        <span className="conv-card-title">{title ?? roomTitle(room)}</span>
        {(description ?? room.description) && <span className="conv-card-desc">{description ?? room.description}</span>}
      </Link>
      <span className="conv-card-meta">
        <span>{meta.join(' · ')}</span>
        {action}
      </span>
    </div>
  )
}
