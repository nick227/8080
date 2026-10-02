import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
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
import type { Item } from '../api/types'
import { ConversationHead } from '../features/room/ConversationHead'
import { PeopleStrip, type PresenceActivity } from '../features/room/PeopleStrip'
import { ChatStream, stillsFrom, type StreamRow } from '../features/room/ChatStream'
import { RecordSurface } from '../features/room/RecordSurface'
import { Playback, isPlayable } from '../features/room/Playback'
import { useRoomPost } from '../features/room/useRoomPost'
import '../features/room/room.css'

function roomPeopleFrom(items: Item[], meId: string | undefined, meName: string, activity: PresenceActivity) {
  const seen = new Map<string, string>()
  for (const item of items) seen.set(item.author.id, item.author.name)
  if (meId) seen.set(meId, meName)
  return [...seen].map(([id, name]) => ({
    id,
    name,
    activity: id === meId ? activity : null,
  }))
}

export function Room({ roomId: roomRef }: { roomId: string }) {
  const ui = useUI()
  const items = useData(useShallow(selectAllItems))
  const itemsById = useData((s) => s.itemsById)
  const replaceItems = useData((s) => s.replaceItems)
  const [desk, setDesk] = useState(false)
  const [compose, setCompose] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [activity, setActivity] = useState<PresenceActivity>('here')
  const onActivity = useCallback((next: PresenceActivity) => {
    setActivity((current) => (current === next ? current : next))
  }, [])

  const resolved = useRoomRef(roomRef)
  const roomId = resolved.data
  const room = useRoom(roomId)
  const updateRoom = useUpdateRoom(roomId ?? '')
  const roomItems = useRoomItems(roomId)
  const { pending, post, meId, meName } = useRoomPost(roomId)
  const removeItem = useDeleteItem()

  useEffect(() => {
    if (roomItems.isSuccess) replaceItems(roomItems.items.map(toItem))
  }, [roomItems.dataUpdatedAt, roomItems.isSuccess, replaceItems])
  useEffect(() => () => replaceItems([]), [roomId, replaceItems])

  useLayoutEffect(() => {
    if (!roomId) return
    const params = new URLSearchParams(window.location.search)
    useShell.getState().enterRoom()
    const reply = params.get('reply')
    const action = params.get('action')
    setSkipped(false)
    setCompose(false)
    if (reply) useUI.getState().startReply(reply)
    else if (action === 'write') { setCompose(true); setDesk(true); useUI.getState().startComposing() }
    else if (action === 'capture') { setDesk(true); useUI.getState().startRecording() }
  }, [roomId])

  useEffect(() => {
    const data = room.data
    if (!data) return
    useShell.getState().setRoom({ title: data.title, number: data.number, visibility: data.visibility })
    return () => useShell.getState().setRoom(null)
  }, [room.data])

  useRoomStream(roomId)

  const visible = items.filter((item) => item.text?.trim() || item.media?.length).sort((a, b) => a.number - b.number)
  const newest = [...visible].reverse()
  const replying = ui.state === 'replying' || ui.state === 'composing' || ui.state === 'recording' || ui.state === 'reviewing'
  const replyName = replying && ui.activeItemId ? itemsById[ui.activeItemId]?.author.name : undefined
  const fresh = Boolean(roomId) && roomItems.isSuccess && visible.length === 0 && pending.length === 0
  const showDesk = desk || (fresh && !skipped)
  const playing = ui.state === 'playback' && ui.activeItemId ? itemsById[ui.activeItemId] : undefined

  const startMessage = () => {
    ui.setIdle()
    setCompose(false)
    setDesk(true)
  }

  const advance = (id: string) => {
    const index = visible.findIndex((item) => item.id === id)
    const next = visible.slice(index + 1).find(isPlayable)
    if (next) ui.startPlayback(next.id, 'chronological')
    else ui.setIdle()
  }

  const rows: StreamRow[] = [
    ...[...pending].reverse().map((item) => ({
      id: item.id,
      author: item.author,
      avatarUrl: item.avatarUrl,
      text: item.text,
      media: item.media,
      status: item.status,
      onRetry: item.status === 'failed' ? () => void post(item.input, item.id) : undefined,
    })),
    ...newest.map((item) => ({
      id: item.id,
      author: item.author.name,
      avatarUrl: item.author.avatarUrl,
      postedAt: item.createdAt,
      text: item.text,
      media: stillsFrom(item.media),
      onReply: () => { ui.startReply(item.id); setDesk(true) },
      onDelete: item.author.id === meId
        ? () => {
            void removeItem.mutateAsync(item.id).catch((error: unknown) => {
              ui.setError(error instanceof Error ? error.message : 'Could not delete')
            })
          }
        : undefined,
    })),
  ]

  const data = room.data
  const inviteUrl = data
    ? data.visibility === 'private' && data.inviteCode
      ? `${window.location.origin}/room/${data.id}?invite=${data.inviteCode}`
      : `${window.location.origin}/room/${data.id}`
    : undefined

  return (
    <Panel as="main" variant="shell" className="room-shell">
      <SEO title={data?.title ? `${data.title} - Voice Chat` : 'Room - Voice Chat'} description={`Join ${data?.title ?? 'this room'} on Voice Chat.`} />
      <StageChrome />
      {(ui.error || resolved.error || roomItems.error) && (
        <Label variant="status" className="error" role="alert">
          {ui.error ?? (resolved.error ?? roomItems.error)?.message ?? 'Unable to load'}
          <Control onClick={() => ui.setError(undefined)}>×</Control>
        </Label>
      )}
      {data && <ConversationHead room={data} />}
      <PeopleStrip people={roomPeopleFrom(visible, meId, meName, activity)} meId={meId} inviteUrl={inviteUrl} />
      <div className="room-new-bar">
        <button type="button" className="room-new" onClick={startMessage}>New message</button>
      </div>
      <ChatStream rows={rows} />
      {showDesk && (
        <RecordSurface
          title={fresh && !replyName ? (data?.title ?? 'New conversation') : undefined}
          identity={fresh && !replyName && data ? {
            title: data.title,
            thumbUrl: data.thumbnail?.url ?? null,
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
            setSkipped(true)
            setDesk(false)
          }}
          onSend={async (input) => {
            await post(input)
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
