import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCompanyConversations, useCreateRoom, useLinkCompanyConversation, useWorkspaceChannel } from '@project/sdk'
import { ConversationCard } from '../lobby/ConversationCard'
import { SectionHeader } from '../work/SectionHeader'
import '../lobby/lobby.css'

// Stream on a company page (redesign D2/D3): the company channel first, then the
// conversations members added, of those you can see. Listing never grants access, so
// a new conversation starts private (people you invite) unless you choose public.
export function CompanyConversations({ workspaceId, name }: { workspaceId: string; name: string }) {
  const rooms = useCompanyConversations(workspaceId)
  const channelId = useWorkspaceChannel(workspaceId).data?.roomId ?? null
  const all = rooms.data?.pages.flatMap((p) => p.data) ?? []
  const list = [...all.filter((r) => r.id === channelId), ...all.filter((r) => r.id !== channelId)]
  const [adding, setAdding] = useState(false)
  return (
    <section className="work-page company-conversations" aria-labelledby="company-conversations-title">
      <SectionHeader title="Stream" titleId="company-conversations-title" level={1}>
        {!adding && <button type="button" className="section-add-btn" onClick={() => setAdding(true)}>+ New conversation</button>}
      </SectionHeader>
      <p className="company-conversations-sub">Conversations in {name}</p>
      <div className="company-conversations-body">
        {adding && <NewConversation workspaceId={workspaceId} name={name} onCancel={() => setAdding(false)} />}
        {rooms.isLoading ? <p className="lobby-note" role="status">Loading…</p>
          : rooms.isError ? <p className="lobby-note lobby-note-error" role="alert">Couldn’t load conversations.</p>
            : list.length === 0 ? (
              <p className="lobby-note">No conversations in {name} yet. Start one here, or open a conversation you started and choose “Add to {name}”.</p>
            ) : (
              <div className="conv-grid">
                {list.map((room) => room.id === channelId
                  ? <ConversationCard key={room.id} room={room} title="Company channel" description={`Shared updates for everyone in ${name}.`} />
                  : <ConversationCard key={room.id} room={room} />)}
              </div>
            )}
        {rooms.hasNextPage && (
          <button type="button" className="section-add-btn" disabled={rooms.isFetchingNextPage} onClick={() => void rooms.fetchNextPage()}>
            {rooms.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </button>
        )}
      </div>
    </section>
  )
}

function NewConversation({ workspaceId, name, onCancel }: { workspaceId: string; name: string; onCancel: () => void }) {
  const navigate = useNavigate()
  const create = useCreateRoom()
  const link = useLinkCompanyConversation(workspaceId)
  const [title, setTitle] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [error, setError] = useState('')
  // A room made by an attempt whose listing failed: a retry only lists it (no duplicate).
  const [made, setMade] = useState<string | null>(null)
  const busy = create.isPending || link.isPending
  const submit = async () => {
    setError('')
    try {
      const id = made ?? (await create.mutateAsync({ title: title.trim(), visibility })).id
      setMade(id)
      await link.mutateAsync(id)
      navigate(`/room/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t start the conversation.')
    }
  }
  return (
    <form className="company-new-conversation" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <label>
        <span>Name (optional)</span>
        <input value={title} maxLength={120} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly planning" />
      </label>
      <label>
        <span>Who can see it</span>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}>
          <option value="private">Private: people you invite</option>
          <option value="public">Public: anyone, and listed in the Lobby</option>
        </select>
      </label>
      <p className="company-new-hint">
        It’s listed in {name}.{visibility === 'private' && ' Listing doesn’t give access: invite people from inside the conversation.'}
      </p>
      {error && <p className="room-company-error" role="alert">{error}</p>}
      <div className="company-new-actions">
        <button type="submit" className="section-add-btn" disabled={busy}>{busy ? 'Starting…' : 'Start conversation'}</button>
        <button type="button" className="section-add-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
