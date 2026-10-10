import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { getApiClient, unwrap, useRoomItems, useRoomStream } from '@project/sdk'
import { toItem } from '../../api/adapt'
import type { SendInput } from '../../api/types'
import { useDocuments } from '../documents/store'
import { ChatBox } from '../room/ChatBox'
import { ChatShell } from '../room/ChatShell'
import { ChatStream } from '../room/ChatStream'
import { loadRoomView } from '../room/roomViews'
import { useChatRows } from '../room/useChatRows'
import { useRoomPost } from '../room/useRoomPost'

// The company channel's room id. Opening it creates the channel on first use and joins
// the member (doc/12 §3); repeating it is harmless, so it is cached per company.
function useChannelRoom(workspaceId: string) {
  return useQuery({
    queryKey: ['companyChannel', workspaceId],
    staleTime: Infinity,
    retry: false,
    queryFn: async () =>
      unwrap(await getApiClient().POST('/workspaces/{workspaceId}/channel', { params: { path: { workspaceId } } })).data.roomId,
  }).data
}

/**
 * Company pages with the company's shared channel in the chat rail (redesign D4): the
 * rail shows one room's history (never a mix), here the channel's.
 */
export function CompanyChannelShell({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  // Always the same shell, so the desks never remount when the channel arrives.
  const roomId = useChannelRoom(workspaceId)
  const navigate = useNavigate()
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
      view={loadRoomView()}
      stage={children}
      stream={(
        <>
          <p className="channel-rail-label">
            {roomId ? <Link to={`/room/${roomId}`}>Company channel</Link> : 'Company channel'}
            {error && <span role="alert"> · {error}</span>}
          </p>
          {!roomId ? <p className="channel-rail-label" role="status">Opening…</p> : <ChatStream
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
