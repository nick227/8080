import { useState } from 'react'
import { useMyRooms, useRiver, useJoinRoom, useCreateRoom } from '@project/sdk'
import { toRiverItem } from '../api/adapt'
import { RiverConversation } from './river/RiverConversation'

const seq = (n: number) => String(n).padStart(3, '0')

export function Lobby() {
  const myRooms = useMyRooms()
  const river = useRiver()
  const join = useJoinRoom()
  const createRoom = useCreateRoom()

  const myList = myRooms.data?.pages.flatMap((p) => p.data) ?? []
  const riverList = (river.data?.pages.flatMap((p) => p.data) ?? []).map(toRiverItem)

  const [isCreating, setIsCreating] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createVisibility, setCreateVisibility] = useState<'public' | 'private'>('public')

  const enter = (roomId: string) => { window.location.href = `/room/${roomId}` }

  const handleCreate = async () => {
    if (!createTitle.trim() || createRoom.isPending) return
    const room = await createRoom.mutateAsync({ title: createTitle.trim(), visibility: createVisibility })
    enter(room.id)
  }

  const isLoading = myRooms.isLoading || river.isLoading
  const isError = myRooms.isError || river.isError

  return (
    <div className="lobby-body">
      <div className="lobby-head">
        <p className="lobby-kicker">Your rooms</p>
        <button type="button" className="lobby-go" onClick={() => setIsCreating(!isCreating)}>
          {isCreating ? 'Cancel' : 'New conversation'}
        </button>
      </div>

      {isCreating && (
        <form className="lobby-create" onSubmit={(e) => { e.preventDefault(); void handleCreate() }}>
          <input
            className="field"
            autoFocus
            placeholder="Conversation title…"
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
          />
          <div className="lobby-create-row">
            <select
              value={createVisibility}
              onChange={(e) => setCreateVisibility(e.target.value as 'public' | 'private')}
              className="plain-select"
            >
              <option value="public">Public (discoverable)</option>
              <option value="private">Private (invite only)</option>
            </select>
            <button type="submit" className="lobby-go" disabled={!createTitle.trim() || createRoom.isPending}>Create ↗</button>
          </div>
        </form>
      )}

      {isError && <p className="lobby-note lobby-note-error">Failed to load rooms</p>}
      {isLoading && !isError && <p className="lobby-note">Loading directory...</p>}

      {!isLoading && !isError && (
        <>
          {myList.length === 0 ? (
            <p className="lobby-note">No active conversations.</p>
          ) : (
            myList.map((room) => (
              <div key={room.id} className="lobby-row lobby-item" onClick={() => enter(room.id)}>
                <span className="item-no">{seq(room.number)}</span>
                <span className="lobby-title">{room.title}</span>
                <span className="lobby-meta">{room.visibility} · {room.memberCount}</span>
                <button type="button" className="lobby-go" onClick={(e) => { e.stopPropagation(); enter(room.id) }}>Enter ↗</button>
              </div>
            ))
          )}

          <div className="lobby-head lobby-section">
            <p className="lobby-kicker">River</p>
          </div>
          {riverList.length === 0 ? (
            <p className="lobby-note">No recent public conversations.</p>
          ) : (
            riverList.map((item) => (
              // KEEP: River conversation explorer lives in features/river/RiverConversation.tsx
              <RiverConversation key={item.id} item={item} onJoin={() => join.mutate({ roomId: item.roomId }, { onSuccess: () => enter(item.roomId) })} />
            ))
          )}
        </>
      )}
    </div>
  )
}
