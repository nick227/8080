import { useCompanyConversations } from '@project/sdk'
import { ConversationCard } from '../lobby/ConversationCard'
import { SectionHeader } from '../work/SectionHeader'
import '../lobby/lobby.css'

// The company's conversations (Stream on a company page, redesign D2/D3): its channel
// and the rooms members have added, of those you can see. Rooms are added from the
// room itself ("Add to …" beside the layout menu), by their owner.
export function CompanyConversations({ workspaceId, name }: { workspaceId: string; name: string }) {
  const rooms = useCompanyConversations(workspaceId)
  const list = rooms.data?.pages.flatMap((p) => p.data) ?? []
  return (
    <section className="work-page company-conversations" aria-labelledby="company-conversations-title">
      <SectionHeader title="Conversations" titleId="company-conversations-title" level={1} />
      <div className="company-conversations-body">
        {rooms.isLoading ? <p className="lobby-note" role="status">Loading…</p>
          : rooms.isError ? <p className="lobby-note lobby-note-error" role="alert">Couldn’t load conversations.</p>
            : list.length === 0 ? (
              <p className="lobby-note">No conversations in {name} yet. Open a conversation you started and choose “Add to {name}”.</p>
            ) : (
              <div className="conv-grid">{list.map((room) => <ConversationCard key={room.id} room={room} />)}</div>
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
