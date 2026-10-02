import { useState } from 'react'
import { useMyRooms, useRooms, useCreateRoom, type Room } from '@project/sdk'
import { useShell } from '../state/shell'
import { useNavigate } from 'react-router-dom'

export function Lobby() {
  const myRooms = useMyRooms()
  const publicRooms = useRooms()
  const createRoom = useCreateRoom()
  const [creating, setCreating] = useState(false)

  const myList = myRooms.data?.pages.flatMap((p) => p.data) ?? []
  const publicListAll = publicRooms.data?.pages.flatMap((p) => p.data) ?? []
  
  const myIds = new Set(myList.map(r => r.id))
  const publicList = publicListAll.filter(r => !myIds.has(r.id))

  const navigate = useNavigate()

  const enter = (roomId: string) => { navigate(`/room/${roomId}`) }

  const start = () => {
    useShell.getState().openRecord()
  }

  // format duration Ms
  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const renderCard = (room: Room) => (
    <div key={room.id} className="room-card" onClick={() => enter(room.id)} style={{ cursor: 'pointer', border: '1px solid var(--line)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <img src={room.thumbnail?.url || 'https://via.placeholder.com/300x200'} alt={room.title} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 4, background: 'var(--surface-sunken)' }} />
      <div>
        <h3 style={{ margin: 0, fontSize: 16 }}>{room.title}</h3>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>{room.description}</p>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)', marginTop: 'auto' }}>
        <span>{room.responseCount} replies</span>
        <span>{formatDuration(room.durationMs)} duration</span>
        <span>{room.lastResponseAt ? new Date(room.lastResponseAt).toLocaleDateString() : 'No activity'}</span>
      </div>
    </div>
  )

  const isLoading = myRooms.isLoading || publicRooms.isLoading
  const isError = myRooms.isError || publicRooms.isError

  return (
    <div className="lobby-body">
      <div className="lobby-head">
        <button type="button" className="lobby-pill" disabled={creating} onClick={() => void start()}>
          {creating ? 'CREATING' : 'NEW CONVERSATION'}
        </button>
      </div>

      {isError && <p className="lobby-note lobby-note-error">Failed to load rooms</p>}
      {isLoading && !isError && <p className="lobby-note">Loading directory...</p>}

      {!isLoading && !isError && (
        <>
          <div style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 16 }}>Your Rooms</h2>
            {myList.length === 0 ? (
              <p className="lobby-note">No active conversations.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24 }}>
                {myList.map(renderCard)}
              </div>
            )}
          </div>

          <div>
            <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 16 }}>Public Rooms</h2>
            {publicList.length === 0 ? (
              <p className="lobby-note">No public conversations.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24 }}>
                {publicList.map(renderCard)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
