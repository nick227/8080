import { useState } from 'react'
import { useMutes, useRoomBots, useRoomParticipants, useSetBotSeat, useSetMute } from '@project/sdk'
import { PersonName } from '../../components/PersonName'
import './people.css'

// Everyone in the conversation — people and bots in one list, one row shape
// (doc/08: no bot-specific UI). Actions come from permission, not from who it is:
// anyone can mute anyone else (global, server-enforced); the owner can remove a
// seated bot or add one that isn't here.
export function RoomPeople({ roomId, meId, owner }: { roomId: string; meId?: string; owner: boolean }) {
  const [open, setOpen] = useState(false)
  const participants = useRoomParticipants(roomId).data ?? []
  const muted = new Set((useMutes().data ?? []).map((u) => u.id))
  const bots = useRoomBots(owner && open ? roomId : undefined).data ?? []
  const setMute = useSetMute()
  const setSeat = useSetBotSeat(roomId)
  const here = participants.filter((p) => p.present).length
  const addable = bots.filter((b) => !b.seated)

  return (
    <div className="room-people-list" data-open={open || undefined}>
      <button type="button" className="room-people-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        People · {here}
      </button>
      {open && (
        <ul>
          {participants.map((p) => {
            const self = p.user.id === meId
            const isMuted = muted.has(p.user.id)
            return (
              <li key={p.user.id} data-present={p.present || undefined} data-muted={isMuted || undefined}>
                <PersonName className="room-people-name" name={self ? 'You' : p.user.name} tag={p.user.tag} />
                <span className="room-people-actions">
                  {!self && (
                    <button type="button" disabled={setMute.isPending} onClick={() => setMute.mutate({ userId: p.user.id, muted: !isMuted })}>
                      {isMuted ? 'Unmute' : 'Mute'}
                    </button>
                  )}
                  {owner && p.role === 'bot' && (
                    <button type="button" disabled={setSeat.isPending} onClick={() => setSeat.mutate({ userId: p.user.id, seated: false })}>
                      Remove
                    </button>
                  )}
                </span>
              </li>
            )
          })}
          {owner && addable.map((b) => (
            <li key={b.user.id} data-addable>
              <PersonName className="room-people-name" name={b.user.name} tag={b.user.tag} />
              <span className="room-people-actions">
                <button type="button" disabled={setSeat.isPending} onClick={() => setSeat.mutate({ userId: b.user.id, seated: true })}>Add</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
