import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useCapture } from '../state/capture'
import { uploadMedia, useDeleteItem, useRoom, useRoomItems, useRoomStream, useUpdateRoom } from '@project/sdk'
import { Panel } from '../components/Panel'
import { Label } from '../components/Label'
import { Control } from '../components/Control'
import { StageChrome } from '../components/StageChrome'
import { SEO } from '../components/SEO'
import { toItem } from '../api/adapt'
import { useRoomRef } from '../app/useRoomRef'
import { useData, selectAllItems } from '../state/data'
import { useUI } from '../state/ui'
import { useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import type { Item, SendInput } from '../api/types'
import { ConversationHead } from '../features/room/ConversationHead'
import { PeopleStrip, roomPeopleFrom, type PresenceActivity } from '../features/room/PeopleStrip'
import { ChatShell } from '../features/room/ChatShell'
import { RoomFloor } from '../features/room/RoomFloor'
import { ViewSwitch } from '../features/room/ViewSwitch'
import { loadRoomView, saveRoomView, seatsFrom, type RoomView } from '../features/room/roomViews'
import { ChatStream, stillsFrom, type StreamRow } from '../features/room/ChatStream'
import { RecordSurface } from '../features/room/RecordSurface'
import { Playback, isPlayable } from '../features/room/Playback'
import { useRoomPost } from '../features/room/useRoomPost'
import { pictureOf } from '../utils/thumbnail'
import { roomTitle } from '../utils/room'
import { markRead, readNumber } from '../features/room/readCursor'
import '../features/room/room.css'

export function Room({ roomId: roomRef }: { roomId: string }) {
  const ui = useUI()
  const items = useData(useShallow(selectAllItems))
  const itemsById = useData((s) => s.itemsById)
  const replaceItems = useData((s) => s.replaceItems)
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
  const [speakerId, setSpeakerId] = useState<string>()
  const chooseView = (next: RoomView) => {
    setView(next)
    saveRoomView(next)
  }
  const removeItem = useDeleteItem()

  const [itemsError, setItemsError] = useState<string>()
  const [itemsSuccess, setItemsSuccess] = useState(false)
  // Stable: RoomItemsSync re-mirrors the room whenever this changes.
  const onItemsSuccess = useCallback(() => setItemsSuccess(true), [])
  useEffect(() => () => { replaceItems([]); setItemsSuccess(false) }, [roomId, replaceItems])
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

  const visible = items.filter((item) => item.text?.trim() || item.media?.length).sort((a, b) => a.number - b.number)
  const replying = ui.state === 'replying' || ui.state === 'composing' || ui.state === 'recording' || ui.state === 'reviewing'
  const replyName = replying && ui.activeItemId ? itemsById[ui.activeItemId]?.author.name : undefined
  const fresh = Boolean(roomId) && itemsSuccess && visible.length === 0 && pending.length === 0
  const showDesk = desk
  const playing = ui.state === 'playback' && ui.activeItemId ? itemsById[ui.activeItemId] : undefined

  const startMessage = () => {
    ui.setIdle()
    setCompose(false)
    setDesk(true)
  }

  const send = async (input: SendInput, retryId?: string) => {
    setPin((n) => n + 1)
    await post(input, retryId)
  }

  const playAll = () => {
    const firstPlayable = visible.find(isPlayable)
    if (firstPlayable) ui.startPlayback(firstPlayable.id, 'chronological')
  }

  const advance = (id: string) => {
    const index = visible.findIndex((item) => item.id === id)
    const next = visible.slice(index + 1).find(isPlayable)
    if (next) ui.startPlayback(next.id, 'chronological')
    else ui.setIdle()
  }

  // Row actions go through a ref so cached rows never hold stale closures.
  const actions = useRef({ reply: (_id: string) => {}, remove: (_id: string) => {} })
  actions.current = {
    reply: (id) => { ui.startReply(id); setDesk(true) },
    remove: (id) => {
      void removeItem.mutateAsync(id).catch((error: unknown) => {
        ui.setError(error instanceof Error ? error.message : 'Could not delete')
      })
    },
  }
  // One row object per item, reused while the item (and who is viewing) is unchanged,
  // so a live event re-renders only the row it touched.
  const rowCache = useRef(new WeakMap<Item, { meId: string | undefined; row: StreamRow }>())
  const rowFor = (item: Item): StreamRow => {
    const cached = rowCache.current.get(item)
    if (cached && cached.meId === meId) return cached.row
    const row: StreamRow = {
      id: item.id,
      authorId: item.author.id,
      author: item.author.name,
      avatarUrl: item.author.avatarUrl,
      postedAt: item.createdAt,
      text: item.text,
      media: stillsFrom(item.media),
      onReply: () => actions.current.reply(item.id),
      onDelete: item.author.id === meId ? () => actions.current.remove(item.id) : undefined,
    }
    rowCache.current.set(item, { meId, row })
    return row
  }

  const rows: StreamRow[] = [
    ...visible.map(rowFor),
    ...pending.map((item) => ({
      id: item.id,
      authorId: meId,
      author: item.author,
      avatarUrl: item.avatarUrl,
      text: item.text,
      media: item.media,
      status: item.status,
      onRetry: item.status === 'failed' ? () => void send(item.input, item.id) : undefined,
    })),
  ]

  const latestNumber = visible.at(-1)?.number
  const catchUp = useCallback(() => {
    if (!meId || !roomId || latestNumber == null) return
    if ((readNumber(meId, roomId) ?? -1) >= latestNumber) return
    markRead(meId, roomId, latestNumber)
    setReadMark((n) => n + 1)
  }, [meId, roomId, latestNumber])
  const stored = meId && roomId ? readNumber(meId, roomId) : null
  const anchorId = stored == null || readMark < 0 ? undefined : visible.find((item) => item.number > stored)?.id
  const people = roomPeopleFrom(visible, meId, meName, meAvatar, activity)

  const data = room.data
  const inviteUrl = data
    ? data.visibility === 'private' && data.inviteCode
      ? `${window.location.origin}/room/${data.id}?invite=${data.inviteCode}`
      : `${window.location.origin}/room/${data.id}`
    : undefined

  return (
    <Panel as="main" variant="shell" className="room-shell">
      {roomId && <RoomItemsSync roomId={roomId} onError={setItemsError} onSuccess={onItemsSuccess} />}
      <SEO title={data ? `${roomTitle(data)} - Voice Chat` : 'Room - Voice Chat'} description={`Join ${data ? roomTitle(data) : 'this room'} on Voice Chat.`} />
      <StageChrome />
      {(ui.error || resolved.error || itemsError) && (
        <Label variant="status" className="error" role="alert">
          {ui.error ?? resolved.error?.message ?? itemsError ?? 'Unable to load'}
          <Control onClick={() => ui.setError(undefined)}>×</Control>
        </Label>
      )}
      <ChatShell
        header={data && (
          <ConversationHead
            room={data}
            onPlayAll={visible.some(isPlayable) ? playAll : undefined}
            views={<ViewSwitch value={view} onChange={chooseView} />}
            people={<PeopleStrip people={people} meId={meId} inviteUrl={inviteUrl} />}
          />
        )}
        view={view}
        stage={(
          <RoomFloor
            view={view}
            item={visible.at(-1)}
            items={visible}
            seats={seatsFrom(people, visible, meId, meGuest)}
            speakerId={speakerId}
            onPick={setSpeakerId}
            onOpen={(id) => ui.startPlayback(id, 'chronological')}
          />
        )}
        stream={(
          <ChatStream
            key={`${roomId ?? 'pending'}:${itemsSuccess ? 'ready' : 'wait'}`}
            rows={rows}
            pin={pin}
            anchorId={itemsSuccess ? anchorId : undefined}
            onCaughtUp={catchUp}
          />
        )}
        dock={(
          <div className="room-dock">
            <button type="button" className="room-new" onClick={startMessage}>New message</button>
          </div>
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
            setDesk(false)
          }}
          onSend={async (input) => {
            await send(input)
            if (useUI.getState().error) return
            useCapture.getState().complete()
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
          onReply={() => { ui.startReply(playing.id); setDesk(true) }}
        />
      )}
    </Panel>
  )
}

function RoomItemsSync({ roomId, onError, onSuccess }: { roomId: string; onError: (message?: string) => void; onSuccess: () => void }) {
  const roomItems = useRoomItems(roomId)
  const replaceItems = useData((s) => s.replaceItems)
  useEffect(() => {
    if (roomItems.isSuccess) {
      replaceItems(roomItems.items.map(toItem))
      onSuccess()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomItems.dataUpdatedAt])
  const message = roomItems.error?.message
  useEffect(() => {
    if (message !== undefined) onError(message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message])
  return null
}
