import { useEffect, useLayoutEffect } from 'react'
import { type ReactionType, type SendInput } from '../api/types'
import { Feed } from '../features/Feed'
import { Instrument } from '../features/Instrument'
import { useUI } from '../state/ui'
import { useData, selectAllItems } from '../state/data'
import { useShallow } from 'zustand/react/shallow'
import { Panel } from '../components/Panel'
import { Label } from '../components/Label'
import { Control } from '../components/Control'
import { Anchors, ReplyTether } from '../components/Anchors'
import { Blobs } from '../components/Blobs'
import { AnimatePresence, motion } from 'motion/react'
import { useRoom, useRoomItems, useRoomStream, useSendMessage, useReplyToItem, useSetReaction } from '@project/sdk'
import { toItem } from '../api/adapt'
import { resolveMediaIds } from '../api/sendMedia'
import { useRoomRef } from '../app/useRoomRef'
import { StageChrome } from '../components/StageChrome'
import { useShell } from '../state/shell'
import { ReplyInstrument } from '../components/ReplyInstrument'

const REPLY_STATES = new Set(['replying', 'composing', 'recording', 'reviewing'])

export function Room({ roomId: roomRef }: { roomId: string }) {
  const ui = useUI()
  const conversationOpen = useShell((s) => s.surface) === 'conversation'
  const items = useData(useShallow(selectAllItems))
  const replaceItems = useData((s) => s.replaceItems) // stable action; never a dependency on store data

  // /room/:ref → real room id (dev resolver handles "demo" and ?invite=)
  const resolved = useRoomRef(roomRef)
  const roomId = resolved.data
  const room = useRoom(roomId)

  // SDK → normalized store. The SDK cache is the source of truth (fetches, mutations
  // and SSE events all land there); mirror it into state/data.ts only when the query
  // data actually changes (dataUpdatedAt), so replacing the store can't re-trigger this.
  const roomItems = useRoomItems(roomId)
  useEffect(() => {
    if (roomItems.isSuccess) replaceItems(roomItems.items.map(toItem))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomItems.dataUpdatedAt, roomItems.isSuccess, replaceItems])
  useEffect(() => () => replaceItems([]), [roomId, replaceItems]) // don't leak items across rooms
  useLayoutEffect(() => {
    if (!roomId) return
    const params = new URLSearchParams(window.location.search)
    const replyTarget = params.get('reply')
    const action = params.get('action')
    if (replyTarget) {
      useUI.getState().startReply(replyTarget)
      useShell.getState().openRecord()
    } else if (action === 'write') {
      useShell.getState().openRecord()
      useUI.getState().startComposing()
    } else if (action === 'capture' || action === 'upload') {
      useShell.getState().openRecord()
    } else {
      useShell.getState().enterRoom()
    }
  }, [roomId])

  useEffect(() => {
    const data = room.data
    if (!data) return
    useShell.getState().setRoom({ title: data.title, number: data.number, visibility: data.visibility })
    return () => useShell.getState().setRoom(null)
  }, [room.data])

  useRoomStream(roomId)

  const sendMessage = useSendMessage(roomId ?? '')
  const replyToItem = useReplyToItem(roomId ?? '')
  const react = useSetReaction()

  const onReact = (itemId: string, type: ReactionType) => {
    const current = items.find((i) => i.id === itemId)?.reactions.find((r) => r.type === type)
    react.mutate({ itemId, type, on: !current?.reacted }) // toggle the caller's own reaction
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (ui.state === 'replying' && ui.activeItemId) {
      params.set('reply', ui.activeItemId)
    } else {
      params.delete('reply')
    }
    const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`
    window.history.replaceState(null, '', newUrl)
  }, [ui.state, ui.activeItemId])

  const send = async (input: SendInput) => {
    // Uploads captures/files and registers YouTube drafts (shared with every send path).
    const mediaIds = await resolveMediaIds(input.media)

    const isReply = REPLY_STATES.has(ui.state) && !!ui.activeItemId
    const payload = {
      text: input.text,
      mediaIds: mediaIds.length ? mediaIds : undefined
    }

    if (isReply) {
      // The moment was captured when REPLY HERE was chosen, not now at Send.
      const anchor = ui.replyAnchorMs != null ? { anchorStartMs: ui.replyAnchorMs } : {}
      await replyToItem.mutateAsync({ itemId: ui.activeItemId!, ...payload, ...anchor })
    } else {
      await sendMessage.mutateAsync(payload)
    }
    
    ui.setIdle()
  }

  return (
    <Panel as={motion.main} variant="shell" layout>
      <Blobs count={room.data?.memberCount ?? 3} />
      <Anchors />
      <StageChrome />

      {(ui.error || resolved.error || roomItems.error) && (
        <Label variant="status" className="error" role="alert">
          {ui.error ?? (resolved.error ?? roomItems.error)?.message ?? 'Unable to load'}
          <Control onClick={() => ui.setError(undefined)}>×</Control>
        </Label>
      )}

      <AnimatePresence>
        {conversationOpen && (
          <motion.div
            key="conversation"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: ui.state === 'selected' ? 0.3 : 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <Feed items={items} onReply={(id) => { ui.startReply(id); useShell.getState().openRecord() }} onReact={onReact} />
          </motion.div>
        )}
      </AnimatePresence>
      <Instrument onSend={send} />
      <ReplyTether />
      <ReplyInstrument 
        isActive={REPLY_STATES.has(ui.state) && !!ui.activeItemId}
        targetId={ui.activeItemId ?? undefined}
        targetTimestamp={ui.replyAnchorMs != null ? new Date(ui.replyAnchorMs).toISOString().substr(14, 5) : undefined}
        onCancel={() => ui.setIdle()}
        onSend={() => { ui.setIdle(); send({ text: 'Test from ReplyInstrument' }); }}
      />
    </Panel>
  )
}

