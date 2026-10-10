import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useCapture } from '../state/capture'
import { uploadMedia, useRoom, useRoomCompany, useRoomItems, useRoomParticipants, useRoomStream, useUpdateRoom } from '@project/sdk'
import { Panel } from '../components/Panel'
import { Label } from '../components/Label'
import { Control } from '../components/Control'
import { StageChrome } from '../components/StageChrome'
import { SEO } from '../components/SEO'
import { toItem } from '../api/adapt'
import { useRoomRef } from '../app/useRoomRef'
import { useUI } from '../state/ui'
import { useShell } from '../state/shell'
import { useData } from '../state/data'
import type { Item, SendInput } from '../api/types'
import { roomPeopleFrom, type PresenceActivity } from '../features/room/PeopleStrip'
import { ChatShell } from '../features/room/ChatShell'
import { TeamLayoutMenu } from '../features/room/TeamLayoutMenu'
import { RoomFloor } from '../features/room/RoomFloor'
import { WorkNav } from '../features/work/WorkNav'
import { useDocuments } from '../features/documents/store'
import { CalendarPage, WorkPage } from '../features/work/WorkPage'
import { CompanyProfilePanel } from '../features/profile/CompanyProfilePanel'
import { TeamDesk } from '../features/team/TeamDesk'

import type { Desk } from '../features/work/sections'
import { deskPath, useWorkPlace } from '../features/records/navigation'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { loadRoomView, saveRoomView, seatsFrom, type RoomView } from '../features/room/roomViews'
import { ChatStream } from '../features/room/ChatStream'
import { ChatBox } from '../features/room/ChatBox'
import { RecordSurface } from '../features/room/RecordSurface'
import { Playback, isPlayable } from '../features/room/Playback'
import { useRoomPost } from '../features/room/useRoomPost'
import { useChatRows } from '../features/room/useChatRows'
import { pictureOf } from '../utils/thumbnail'
import { roomTitle } from '../utils/room'
import { LiveRoom } from '../features/room/live/LiveRoom'
import { HostChannelProvider, useHostChannel } from '../features/room/hostChannel'
import '../features/room/room.css'
import { useCurrentWorkspace } from '../app/workspace'
import { RoomCompany } from '../features/room/RoomCompany'

export function Room({ roomId: roomRef }: { roomId: string }) {
  const ui = useUI()

  const [desk, setDesk] = useState(false)
  const [compose, setCompose] = useState(false)
  const [profileFor, setProfileFor] = useState<string | null>(null)
  const [pin, setPin] = useState(0)
  const [activity, setActivity] = useState<PresenceActivity>('here')
  const onActivity = useCallback((next: PresenceActivity) => {
    setActivity((current) => (current === next ? current : next))
  }, [])

  const resolved = useRoomRef(roomRef)
  const roomId = resolved.data
  const room = useRoom(roomId)
  const updateRoom = useUpdateRoom(roomId ?? '')
  const { pending, post, meId, meName, meAvatar, meGuest } = useRoomPost(roomId)
  const [view, setView] = useState<RoomView>(loadRoomView)
  const [place, setPlace] = useWorkPlace()
  const [queue, setQueue] = useState<Item[]>([])
  const knownIds = useRef<Set<string> | null>(null)
  const newestSeen = useRef(0)
  useEffect(() => {
    knownIds.current = null
    newestSeen.current = 0
    setQueue([])
  }, [roomId])
  const chooseView = (next: RoomView) => {
    setView(next)
    saveRoomView(next)
  }
  const navigate = useNavigate()
  const location = useLocation()
  const { taskKey } = useParams()
  const current = useCurrentWorkspace()
  const workspace = current.workspace
  // Work and Manage live on the company's page (redesign §4, Phase 2b); a room keeps its
  // conversation. Task pages opened inside a room stay here (task keys repeat across
  // companies, so a link can't name its company yet).
  const openPlace = (next: Desk) => {
    const ws = current.workspace
    // The company page says where you came from, so the swapped chat rail isn't a surprise.
    if (next !== 'stream' && ws) navigate(deskPath(`/c/${ws.id}`, next), { state: { fromRoom: { id: roomId, title: room.data ? roomTitle(room.data) : 'the conversation' } } })
    else setPlace(next)
  }

  const roomItemsResult = useRoomItems(roomId)
  const itemsError = roomItemsResult.error?.message
  const itemsSuccess = roomItemsResult.isSuccess
  const items = useMemo(() => (roomItemsResult.items || []).map(toItem), [roomItemsResult.items])
  const captureError = useCapture((s) => s.error)
  const itemsById = useMemo(() => {
    const map: Record<string, Item> = {}
    for (const item of items) map[item.id] = item
    return map
  }, [items])

  const replaceItems = useData((s) => s.replaceItems)
  useEffect(() => () => { replaceItems([]) }, [roomId, replaceItems])
  useLayoutEffect(() => {
    if (!roomId) return
    const params = new URLSearchParams(window.location.search)
    useShell.getState().enterRoom()
    const reply = params.get('reply')
    const action = params.get('action')
    setCompose(false)
    if (reply) useUI.getState().startReply(reply)
    else if (action === 'write') { setCompose(true); setDesk(true); useUI.getState().startComposing() }
    else if (action === 'capture') { setDesk(true); useUI.getState().startRecording() }
  }, [roomId])

  useEffect(() => {
    const data = room.data
    if (!data) return
    useShell.getState().setRoom({ title: roomTitle(data), number: data.number, visibility: data.visibility })
    return () => useShell.getState().setRoom(null)
  }, [room.data])

  useRoomStream(roomId)

  const visible = useMemo(() => items.filter((item) => item.text?.trim() || item.media?.length).sort((a, b) => a.number - b.number), [items])
  useEffect(() => {
    if (!itemsSuccess) return
    if (!knownIds.current) {
      knownIds.current = new Set(visible.map((item) => item.id))
      newestSeen.current = visible.at(-1)?.number ?? 0
      return
    }
    const arrived = visible.filter((item) => !knownIds.current?.has(item.id))
    if (!arrived.length) return
    for (const item of arrived) knownIds.current.add(item.id)
    const staged = arrived.filter((item) => !item.chat && item.number > newestSeen.current)
    newestSeen.current = Math.max(newestSeen.current, visible.at(-1)?.number ?? 0)
    if (staged.length) setQueue((current) => [...current, ...staged])
  }, [visible, itemsSuccess])
  const replying = ui.state === 'replying' || ui.state === 'composing' || ui.state === 'recording' || ui.state === 'reviewing'
  const replyName = replying && ui.activeItemId ? itemsById[ui.activeItemId]?.author.name : undefined
  const fresh = Boolean(roomId) && itemsSuccess && !roomItemsResult.hasNextPage && visible.length === 0 && pending.length === 0
  const showDesk = desk
  const playing = ui.state === 'playback' && ui.activeItemId ? itemsById[ui.activeItemId] : undefined

  const send = useCallback(async (input: SendInput, retryId?: string) => {
    setPin((n) => n + 1)
    await post(input, retryId)
  }, [post])
  const chat = useCallback(async (input: SendInput) => {
    setPin((n) => n + 1)
    return post(input, undefined, { chat: true })
  }, [post])

  const advance = (id: string) => {
    const index = visible.findIndex((item) => item.id === id)
    const next = visible.slice(index + 1).find(isPlayable)
    if (next) ui.startPlayback(next.id, 'chronological')
    else ui.setIdle()
  }

  const hostChannel = useHostChannel(roomId)
  // A room listed under a company: its mark shows only when that's the company shown;
  // listed under one you aren't in, you get just the conversation (D8).
  const listingQuery = useRoomCompany(roomId)
  const listing = listingQuery.data
  const listedHere = Boolean(listing?.member && listing.id === workspace?.id)
  const listedElsewhere = Boolean(listing && !listing.member)
  // Guests and accounts without a company only get the conversation (D8).
  const shownPlace = (!current.loading && !workspace) || listedElsewhere ? 'stream' : place
  // An old /room/:id?desk=… link: move to the company's page, keeping the rest of the query.
  const toCompany = shownPlace !== 'stream' && !taskKey
  useEffect(() => {
    if (!toCompany || current.loading || listingQuery.isLoading || !workspace) return
    const next = new URLSearchParams(location.search)
    next.delete('desk')
    if (shownPlace === 'company') next.delete('view')
    navigate({ pathname: deskPath(`/c/${workspace.id}`, shownPlace), search: next.toString() }, { replace: true, state: location.state })
  }, [toCompany, current.loading, listingQuery.isLoading, workspace, shownPlace, location.search, location.state, navigate])
  const { rows, catchUp, anchorId } = useChatRows({
    roomId,
    meId,
    visible,
    pending,
    send,
    onReply: (id) => { setCompose(false); ui.startReply(id); setDesk(true) },
    onOpenLink: (link) => {
      if (link.type === 'document') {
        // Opens in Documents, in the link's workspace; an unavailable one says so there.
        void useDocuments.getState().openFromLink(link.workspaceId, link.id).finally(() => navigate(`/c/${link.workspaceId}/documents`))
        return
      }
      if (link.type === 'contact' || link.type === 'compose') {
        openPlace('contacts')
        return
      }
      if (link.type === 'profile') setProfileFor(link.id) // Edit company profile (id = workspace)
    },
    onError: (message) => ui.setError(message),
  })
  // The roster seats people and bots alike.
  const participants = useRoomParticipants(roomId).data
  const people = roomPeopleFrom(visible, meId, meName, meAvatar, activity, participants)

  const data = room.data
  const openPost = () => {
    ui.setIdle()
    ui.startComposing()
    setCompose(true)
    setDesk(true)
  }

  const openRecord = () => {
    ui.setIdle()
    ui.startRecording()
    setCompose(false)
    setDesk(true)
  }

  return (
    <LiveRoom roomId={roomId}>
    <Panel as="main" variant="shell" className="room-shell">
      {roomId && <RoomItemsSync roomId={roomId} />}
      <SEO title={data ? `${roomTitle(data)} - Voice Chat` : 'Room - Voice Chat'} description={`Join ${data ? roomTitle(data) : 'this room'} on Voice Chat.`} />
      <StageChrome />
      {(ui.error || resolved.error || itemsError || captureError) && (
        <Label variant="status" className="error" role="alert">
          {ui.error ?? resolved.error?.message ?? itemsError ?? captureError ?? 'Unable to load'}
          <Control onClick={() => {
            ui.setError(undefined)
            if (captureError) useCapture.setState({ error: undefined })
          }}>×</Control>
        </Label>
      )}
      <HostChannelProvider value={hostChannel}>
      <ChatShell
        view={view}
        stage={(
          <div className="work-column">
            <WorkNav desk={shownPlace} compact showCompany={listedHere} showWork={!listedElsewhere} layoutControl={shownPlace === 'stream' ? <>{roomId && <RoomCompany roomId={roomId} />}<TeamLayoutMenu view={view} onChange={chooseView} /></> : undefined} onSelect={(next) => {
              if (next === 'documents') useDocuments.getState().open(null)
              openPlace(next)
            }} />
            {toCompany ? (
              <p className="work-empty" role="status">Opening…</p>
            ) : shownPlace === 'stream' ? (
              <RoomFloor
                view={view}
                seats={seatsFrom(people, meId, meGuest)}
                item={queue[0]}
                next={queue.slice(1)}
                onEnded={() => setQueue((current) => current.slice(1))}
                onSend={send}
                onActivity={onActivity}
              />
            ) : shownPlace === 'team' ? (
              <TeamDesk
                seats={seatsFrom(people, meId, meGuest)}
                roomId={roomId}
              />
            ) : shownPlace === 'calendar' ? (
              <CalendarPage />
            ) : (
              <WorkPage place={shownPlace} roomId={roomId} onPlace={openPlace} onOpenComposer={() => { openPlace('stream'); openRecord(); }} />
            )}
          </div>
        )}
        composer={<ChatBox onSend={chat} onRecord={openRecord} />}
        stream={(
          <ChatStream
            key={`${roomId ?? 'pending'}:${itemsSuccess ? 'ready' : 'wait'}`}
            rows={rows}
            pin={pin}
            anchorId={itemsSuccess ? anchorId : undefined}
            onCaughtUp={catchUp}
            hasOlder={roomItemsResult.hasNextPage}
            loadingOlder={roomItemsResult.isFetchingNextPage}
            onLoadOlder={() => {
              if (!roomItemsResult.isFetching) void roomItemsResult.fetchNextPage()
            }}
          />
        )}
      />
      </HostChannelProvider>
      {profileFor && <CompanyProfilePanel workspaceId={profileFor} onClose={() => setProfileFor(null)} />}
      {showDesk && (
        <RecordSurface
          title={fresh && !replyName ? (data?.title ?? 'New Message') : undefined}
          identity={fresh && !replyName && data ? {
            title: data.title,
            thumbUrl: pictureOf(data.thumbnail),
            onTitle: (title) => {
              void updateRoom.mutateAsync({ title }).catch((error: unknown) => {
                ui.setError(error instanceof Error ? error.message : 'Could not rename')
              })
            },
            onThumb: (file) => {
              void uploadMedia({ file, type: 'image', name: file.name })
                .then((media) => updateRoom.mutateAsync({ thumbnailId: media.id }))
                .catch((error: unknown) => {
                  ui.setError(error instanceof Error ? error.message : 'Could not set image')
                })
            },
          } : undefined}
          compose={compose}
          replyName={replyName}
          onActivity={onActivity}
          onClose={() => {
            useCapture.getState().cancel()
            onActivity('here')
            ui.setIdle()
            setCompose(false)
            setDesk(false)
          }}
          onSend={async (input) => {
            await send(input)
            if (useUI.getState().error) return
            useCapture.getState().complete()
            setCompose(false)
            setDesk(false)
          }}
        />
      )}
      {playing && (
        <Playback
          key={playing.id}
          item={playing}
          onClose={() => ui.setIdle()}
          onEnded={() => advance(playing.id)}
          onReply={() => { setCompose(false); ui.startReply(playing.id); setDesk(true) }}
        />
      )}
    </Panel>
    </LiveRoom>
  )
}

function RoomItemsSync({ roomId }: { roomId: string }) {
  const roomItems = useRoomItems(roomId)
  const replaceItems = useData((s) => s.replaceItems)
  useEffect(() => {
    if (roomItems.isSuccess) {
      replaceItems(roomItems.items.map(toItem))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomItems.dataUpdatedAt])
  return null
}
