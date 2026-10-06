import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useCapture } from '../state/capture'
import { uploadMedia, useChooseOption, useDeleteItem, useRoom, useRoomItems, useRoomParticipants, useRoomStream, useUpdateRoom } from '@project/sdk'
import { isHumanAuthored } from '@project/shared'
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
import { RoomFloor } from '../features/room/RoomFloor'
import { WorkNav } from '../features/work/WorkNav'
import { RoomDocuments } from '../features/documents/RoomDocuments'
import { useDocuments } from '../features/documents/store'
import { CalendarPage, WorkPage } from '../features/work/WorkPage'
import type { Desk } from '../features/work/sections'
import { loadRoomView, saveRoomView, seatsFrom, type RoomView } from '../features/room/roomViews'
import { ChatStream, stillsFrom, type StreamRow } from '../features/room/ChatStream'
import { ChatBox } from '../features/room/ChatBox'
import { RoomPeople } from '../features/room/RoomPeople'
import { RecordSurface } from '../features/room/RecordSurface'
import { Playback, isPlayable } from '../features/room/Playback'
import { useRoomPost } from '../features/room/useRoomPost'
import { pictureOf } from '../utils/thumbnail'
import { roomTitle } from '../utils/room'
import { markRead, readNumber } from '../features/room/readCursor'
import { LiveRoom } from '../features/room/live/LiveRoom'
import '../features/room/room.css'

export function Room({ roomId: roomRef }: { roomId: string }) {
  const ui = useUI()

  const [desk, setDesk] = useState(false)
  const [compose, setCompose] = useState(false)
  const [pin, setPin] = useState(0)
  const [readMark, setReadMark] = useState(0)
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
  const [place, setPlace] = useState<Desk>('team')
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
  const openPlace = (next: Desk) => {
    setPlace(next)
    if (next === 'team') chooseView('grid')
  }
  const removeItem = useDeleteItem()

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

  // Row actions go through a ref so cached rows never hold stale closures.
  const chooseOption = useChooseOption()
  const actions = useRef({ reply: (_id: string) => {}, remove: (_id: string) => {}, choose: async (_id: string, _optionIds: string[]) => {} })
  actions.current = {
    choose: async (itemId, optionIds) => { await chooseOption.mutateAsync({ itemId, optionIds }) },
    reply: (id) => { setCompose(false); ui.startReply(id); setDesk(true) },
    remove: (id) => {
      void removeItem.mutateAsync(id).catch((error: unknown) => {
        ui.setError(error instanceof Error ? error.message : 'Could not delete')
      })
    },
  }
  // One row object per item, reused while the item (and who is viewing) is unchanged,
  // so a live event re-renders only the row it touched.
  const rowCache = useRef(new WeakMap<Item, { meId: string | undefined; row: StreamRow }>())
  const rowFor = useCallback((item: Item): StreamRow => {
    const cached = rowCache.current.get(item)
    if (cached && cached.meId === meId) return cached.row
    const row: StreamRow = {
      id: item.id,
      authorId: item.author.id,
      tag: item.author.tag,
      author: item.author.name,
      avatarUrl: item.author.avatarUrl,
      postedAt: item.createdAt,
      text: item.text,
      media: stillsFrom(item.media),
      choice: item.actions
        ? { actions: item.actions, choice: item.choice, meId, onChoose: (optionIds) => actions.current.choose(item.id, optionIds) }
        : undefined,
      onReply: () => actions.current.reply(item.id),
      onDelete: item.author.id === meId ? () => actions.current.remove(item.id) : undefined,
    }
    rowCache.current.set(item, { meId, row })
    return row
  }, [meId])

  const pendingRows: StreamRow[] = useMemo(() => pending.map((item) => ({
    id: item.id,
    authorId: meId,
    author: item.author,
    avatarUrl: item.avatarUrl,
    text: item.text,
    media: item.media,
    status: item.status,
    onRetry: item.status === 'failed' ? () => void send(item.input, item.id) : undefined,
  })), [pending, meId, send])

  const rows: StreamRow[] = useMemo(() => [
    ...visible.map(rowFor),
    ...pendingRows,
  ], [visible, pendingRows, rowFor])

  const latestNumber = visible.at(-1)?.number
  const catchUp = useCallback(() => {
    if (!meId || !roomId || latestNumber == null) return
    if ((readNumber(meId, roomId) ?? -1) >= latestNumber) return
    markRead(meId, roomId, latestNumber)
    setReadMark((n) => n + 1)
  }, [meId, roomId, latestNumber])
  const stored = meId && roomId ? readNumber(meId, roomId) : null
  const anchorId = stored == null || readMark < 0 ? undefined : visible.find((item) => item.number > stored && isHumanAuthored(item))?.id
  // Bot items never make a room unread (doc/08 I6); the roster seats people and bots alike.
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
      <ChatShell
        view={view}
        stage={(
          <div className="work-column">
            <WorkNav desk={place} teamActive={place === 'team' && view === 'grid'} onSelect={(next) => {
              if (next === 'documents') useDocuments.getState().open(null)
              openPlace(next)
            }} />
            {place === 'team' ? (
              <RoomFloor
                view={view}
                seats={seatsFrom(people, meId, meGuest)}
                item={queue[0]}
                next={queue.slice(1)}
                onEnded={() => setQueue((current) => current.slice(1))}
                onSend={send}
                onActivity={onActivity}
                onView={chooseView}
              />
            ) : place === 'calendar' ? (
              <CalendarPage />
            ) : (
              <WorkPage place={place} roomId={roomId} />
            )}
          </div>
        )}
        composer={<>
          {roomId && <RoomPeople roomId={roomId} meId={meId} owner={data?.role === 'owner'} />}
          <ChatBox onSend={chat} onRecord={openRecord} />
        </>}
        stream={(
          <>
          {roomId && <RoomDocuments roomId={roomId} owner={meName} onOpen={() => openPlace('documents')} />}
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
          </>
        )}
      />
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
