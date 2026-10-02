import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDeleteRoom, useMyRooms, useRooms, type Room } from '@project/sdk'
import { useShell } from '../state/shell'
import { ConversationCard } from './lobby/ConversationCard'
import './lobby/lobby.css'

export function Lobby() {
  const myRooms = useMyRooms()
  const publicRooms = useRooms()
  const deleteRoom = useDeleteRoom()
  const [deleteError, setDeleteError] = useState<string | undefined>()
  const [armedId, setArmedId] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const myList = myRooms.data?.pages.flatMap((p) => p.data) ?? []
  const publicListAll = publicRooms.data?.pages.flatMap((p) => p.data) ?? []
  const myIds = new Set(myList.map(r => r.id))
  const publicList = publicListAll.filter(r => !myIds.has(r.id))

  const start = () => {
    useShell.getState().openRecord()
  }

  const remove = (roomId: string) => {
    setDeleteError(undefined)
    void deleteRoom.mutateAsync(roomId).then(() => {
      if (location.pathname === `/room/${roomId}`) navigate('/')
    }).catch((error: unknown) => {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete')
    })
  }

  const deleteAction = (room: Room) =>
    room.role === 'owner' ? (
      <button
        type="button"
        className="lobby-delete"
        data-armed={armedId === room.id || undefined}
        disabled={deleteRoom.isPending}
        onClick={() => {
          if (armedId !== room.id) { setArmedId(room.id); return }
          setArmedId(null)
          remove(room.id)
        }}
      >
        {armedId === room.id ? 'Confirm' : 'Delete'}
      </button>
    ) : undefined

  const renderCard = (room: Room) => <ConversationCard key={room.id} room={room} action={deleteAction(room)} />

  const isLoading = myRooms.isLoading || publicRooms.isLoading
  const isError = myRooms.isError || publicRooms.isError

  return (
    <div className="lobby-body">
      <div className="lobby-head">
        <button type="button" className="lobby-pill" onClick={() => void start()}>
          NEW CONVERSATION
        </button>
      </div>

      {isError && <p className="lobby-note lobby-note-error">Failed to load conversations</p>}
      {deleteError && <p className="lobby-note lobby-note-error">{deleteError}</p>}
      {isLoading && !isError && <p className="lobby-note">Loading…</p>}

      {!isLoading && !isError && (
        <>
          <section className="lobby-section" aria-label="Your conversations">
            <p className="lobby-kicker">Yours</p>
            {myList.length === 0 ? (
              <p className="lobby-note">You're not in any conversations yet.</p>
            ) : (
              <div className="conv-grid">{myList.map(renderCard)}</div>
            )}
          </section>

          <section className="lobby-section" aria-label="Public conversations">
            <p className="lobby-kicker">Public</p>
            {publicList.length === 0 ? (
              <p className="lobby-note">No other public conversations.</p>
            ) : (
              <div className="conv-grid">{publicList.map(renderCard)}</div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
