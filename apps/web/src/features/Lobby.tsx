import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDeleteRoom, useMyRooms, useRooms, type Room } from '@project/sdk'
import { ConversationCard } from './lobby/ConversationCard'
import './lobby/lobby.css'

export function Lobby() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'public' | 'mine'>('public')

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search)
    }, 250)
    return () => clearTimeout(handler)
  }, [search])

  const myRooms = useMyRooms({ limit: 20 })
  const publicRooms = useRooms({
    q: debouncedSearch.trim() || undefined,
    limit: 12,
  })
  const deleteRoom = useDeleteRoom()
  const [deleteError, setDeleteError] = useState<string | undefined>()
  const [armedId, setArmedId] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const myListAll = myRooms.data?.pages.flatMap((p) => p.data) ?? []
  const publicListAll = publicRooms.data?.pages.flatMap((p) => p.data) ?? []
  const myIds = new Set(myListAll.map(r => r.id))
  const publicList = publicListAll.filter(r => !myIds.has(r.id))

  const myList = debouncedSearch.trim()
    ? myListAll.filter(r => (r.title ?? '').toLowerCase().includes(debouncedSearch.toLowerCase()))
    : myListAll

  const remove = (roomId: string) => {
    setDeleteError(undefined)
    void deleteRoom.mutateAsync(roomId).then(() => {
      if (location.pathname === `/room/${roomId}`) navigate('/conversations')
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

  const isLoading = (activeTab === 'public' ? publicRooms.isLoading : myRooms.isLoading)
  const isError = (activeTab === 'public' ? publicRooms.isError : myRooms.isError)
  const hasJoinedRooms = myListAll.length > 0

  return (
    <div className="lobby-body">
      <div className="lobby-toolbar">
        <div className="lobby-search-bar" role="search">
          <svg className="lobby-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            aria-label="Search public workspaces"
            placeholder="Search public workspaces…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="lobby-search-clear"
              aria-label="Clear search"
              onClick={() => setSearch('')}
            >
              ✕
            </button>
          )}
        </div>

        {hasJoinedRooms && (
          <div className="lobby-tabs" role="tablist" aria-label="Directory view">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'public'}
              className="lobby-tab"
              onClick={() => setActiveTab('public')}
            >
              Public
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'mine'}
              className="lobby-tab"
              onClick={() => setActiveTab('mine')}
            >
              Yours ({myListAll.length})
            </button>
          </div>
        )}
      </div>

      {isError && <p className="lobby-note lobby-note-error">Failed to load public workspaces</p>}
      {deleteError && <p className="lobby-note lobby-note-error">{deleteError}</p>}
      {isLoading && !isError && <p className="lobby-note">Loading public workspaces…</p>}

      {!isLoading && !isError && (
        <>
          {activeTab === 'public' ? (
            <section className="lobby-section" aria-label="Public workspaces">
              {publicList.length === 0 ? (
                <div className="lobby-empty">
                  {debouncedSearch ? (
                    <>
                      <p>No public workspaces found matching “{debouncedSearch}”.</p>
                      <button type="button" className="product-button product-button-secondary" onClick={() => setSearch('')}>
                        Clear search
                      </button>
                    </>
                  ) : (
                    <p className="lobby-note">No other public conversations.</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="conv-grid">{publicList.map(renderCard)}</div>
                  {publicRooms.hasNextPage && (
                    <div className="lobby-pagination">
                      <button
                        type="button"
                        className="product-button product-button-secondary lobby-load-more"
                        disabled={publicRooms.isFetchingNextPage}
                        onClick={() => void publicRooms.fetchNextPage()}
                      >
                        {publicRooms.isFetchingNextPage ? 'Loading more…' : 'Load more public workspaces'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          ) : (
            <section className="lobby-section" aria-label="Your conversations">
              {myList.length === 0 ? (
                <div className="lobby-empty">
                  <p className="lobby-note">
                    {debouncedSearch ? `No conversations matching “${debouncedSearch}”.` : 'You’re not in any conversations yet.'}
                  </p>
                </div>
              ) : (
                <div className="conv-grid">{myList.map(renderCard)}</div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
