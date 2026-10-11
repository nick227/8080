import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useOpenWorkspaceChannel, useRoomItems, useRoomStream, useWorkspaceChannel } from '@project/sdk'
import { toItem } from '../../api/adapt'
import type { SendInput } from '../../api/types'
import { useDocuments } from '../documents/store'
import { ChatBox } from '../room/ChatBox'
import { ChatShell } from '../room/ChatShell'
import { ChatStream } from '../room/ChatStream'
import { useChatRows } from '../room/useChatRows'
import { useRoomPost } from '../room/useRoomPost'

/**
 * Company pages with the company's shared channel in the chat rail (redesign D4): the
 * rail shows one room's history (never a mix), here the channel's. Looking is read-only:
 * someone not yet in the channel joins it with a button, never by visiting.
 */
export function CompanyChannelShell({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  // Always the same shell, so the desks never remount when the channel arrives.
  const channel = useWorkspaceChannel(workspaceId).data
  const join = useOpenWorkspaceChannel()
  const roomId = channel?.joined ? channel.roomId ?? undefined : undefined
  const navigate = useNavigate()
  const fromRoom = (useLocation().state as { fromRoom?: { id: string; title: string } } | null)?.fromRoom
  const items = useRoomItems(roomId)
  useRoomStream(roomId)
  const visible = useMemo(
    () => (items.items ?? []).map(toItem).filter((item) => item.text?.trim() || item.media?.length).sort((a, b) => a.number - b.number),
    [items.items],
  )
  const { pending, post, meId } = useRoomPost(roomId)
  const [pin, setPin] = useState(0)
  const [error, setError] = useState('')
  const send = useCallback(async (input: SendInput, retryId?: string) => {
    setPin((n) => n + 1)
    return post(input, retryId, { chat: true })
  }, [post])
  const { rows, catchUp, anchorId } = useChatRows({
    roomId,
    meId,
    visible,
    pending,
    send,
    onOpenLink: (link) => {
      if (link.type === 'document') {
        void useDocuments.getState().openFromLink(link.workspaceId, link.id).finally(() => navigate(`/c/${workspaceId}/documents`))
        return
      }
      if (link.type === 'contact' || link.type === 'compose') navigate(`/c/${workspaceId}/contacts`)
      else if (link.type === 'profile') navigate(`/c/${workspaceId}`)
    },
    onError: setError,
  })

  return (
    <ChatShell
      view="grid"
      stage={children}
      stream={(
        <>
          <header className="channel-rail-head">
            <h2>Company channel</h2>
            {roomId && <Link to={`/room/${roomId}`}>Open</Link>}
          </header>
          {fromRoom && fromRoom.id !== roomId && (
            <p className="channel-rail-note">
              Showing the company channel. <Link to={`/room/${fromRoom.id}`}>Back to {fromRoom.title}</Link>
            </p>
          )}
          {error && <p className="channel-rail-note" role="alert">{error}</p>}
          {!channel ? <p className="channel-rail-note" role="status">Loading…</p>
            : !roomId ? (
              <div className="channel-rail-join">
                <p>Shared updates for everyone in the company.</p>
                <button type="button" className="section-add-btn" disabled={join.isPending} onClick={() => join.mutate(workspaceId, { onError: (e) => setError(e instanceof Error ? e.message : 'Couldn’t join.') })}>
                  {join.isPending ? 'Joining…' : 'Join the channel'}
                </button>
              </div>
            ) : <ChatStream
            key={`${roomId}:${items.isSuccess ? 'ready' : 'wait'}`}
            rows={rows}
            pin={pin}
            anchorId={items.isSuccess ? anchorId : undefined}
            onCaughtUp={catchUp}
            hasOlder={items.hasNextPage}
            loadingOlder={items.isFetchingNextPage}
            onLoadOlder={() => { if (!items.isFetching) void items.fetchNextPage() }}
          />}
        </>
      )}
      composer={roomId ? <ChatBox onSend={(input) => send(input)} /> : null}
    />
  )
}
