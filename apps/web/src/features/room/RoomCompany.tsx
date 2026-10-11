import { useState } from 'react'
import { useRoom, useSession, useUpdateRoom } from '@project/sdk'

/**
 * The room's own setting beside its Stream: public/private, for its owner. (Listing rooms
 * under a company is paused: each company has one shared channel for now.)
 */
export function RoomCompany({ roomId }: { roomId: string }) {
  const me = useSession().data?.data.id
  const room = useRoom(roomId).data
  const update = useUpdateRoom(roomId)
  const [error, setError] = useState('')
  if (!room || !me || room.ownerId !== me) return null
  return (
    <span className="room-company">
      <label className="room-visibility" title="Who can see this conversation">
        <span aria-hidden>Conversation:</span>
        <select
          aria-label="Who can see this conversation"
          value={room.visibility}
          disabled={update.isPending}
          onChange={(e) => {
            setError('')
            update.mutate({ visibility: e.target.value as 'public' | 'private' }, { onError: (err) => setError(err instanceof Error ? err.message : 'That didn’t work.') })
          }}
        >
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
      </label>
      {error && <span className="room-company-error" role="alert">{error}</span>}
    </span>
  )
}
