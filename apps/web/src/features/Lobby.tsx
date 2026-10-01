import { useState } from 'react'
import { useMyRooms, useRiver, useJoinRoom, useCreateRoom } from '@project/sdk'
import { toRiverItem } from '../api/adapt'
import { RiverConversation } from './river/RiverConversation'

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

  const handleRiverCompose = async (action: string) => {
    if (createRoom.isPending) return
    const room = await createRoom.mutateAsync({ title: 'River Post', visibility: 'public' })
    window.location.href = `/room/${room.id}?action=${action}`
  }

  const isLoading = myRooms.isLoading || river.isLoading
  const isError = myRooms.isError || river.isError

  return (
    <div className="lobby-body">
      <div className="lobby-head">
        <p className="lobby-kicker">Your rooms</p>
        <button type="button" className="lobby-pill" onClick={() => setIsCreating(!isCreating)}>
          {isCreating ? 'CANCEL' : 'START CONVERSATION'}
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
                <span className="lobby-title">{room.title}</span>
                <span className="lobby-meta">{room.visibility} · {room.memberCount}</span>
                <button type="button" className="lobby-go" onClick={(e) => { e.stopPropagation(); enter(room.id) }}>Enter ↗</button>
              </div>
            ))
          )}

          <div className="lobby-section" style={{ marginTop: 48, marginBottom: 32, paddingTop: 40, borderTop: '1px solid var(--line)', display: 'flex', gap: 16, justifyContent: 'flex-start' }}>
            <button type="button" className="lobby-pill" onClick={() => handleRiverCompose('capture')}>POST TO RIVER</button>
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
