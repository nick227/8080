import { useEffect, useMemo, useRef, useState } from 'react'
import { useRoomItems, useRoomStream, useSetReaction } from '@project/sdk'
import { Item } from '../../components/Item'
import { toItem } from '../../api/adapt'
import type { Item as ItemType, ReactionType } from '../../api/types'
import { useUI } from '../../state/ui'
import { useData } from '../../state/data'
import { branchOf } from '../../utils/graph'
import type { Anchor } from '../../utils/anchor'
import { registerRiverItems } from './riverReply'
import { ResponseMap } from '../ResponseMap'
import { revealInSequence } from '../../utils/reveal'
import './river.css'

// River-level conversation exploration for one post, without leaving the River:
// watch → notice activity (markers on the media) → open a moment's replies inline →
// watch/respond → collapse → keep scrolling. Reuses Item (playback, dwell, REPLY HERE,
// reactions, anchors) and the room's own items/stream — no River-specific API.
export type RiverPostItem = ItemType & { roomId: string; roomTitle: string; replyCount: number }

const END_HOLD_MS = 1500

export function RiverConversation({ item, onJoin }: { item: RiverPostItem; onJoin: () => void }) {
  const ui = useUI()
  const cardRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false) // within ~600px: load the conversation
  const [visible, setVisible] = useState(false) // on screen: keep it live
  const [focusIds, setFocusIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const nearObs = new IntersectionObserver(([e]) => e!.isIntersecting && setNear(true), { rootMargin: '600px 0px' })
    const visObs = new IntersectionObserver(([e]) => setVisible(e!.isIntersecting))
    nearObs.observe(el)
    visObs.observe(el)
    return () => { nearObs.disconnect(); visObs.disconnect() }
  }, [])

  // The post's room: loaded lazily, live (SSE) only while visible or open.
  const roomItems = useRoomItems(near ? item.roomId : undefined)
  useRoomStream(visible ? item.roomId : undefined)
  const all = useMemo(() => (roomItems.items ?? []).map(toItem), [roomItems.dataUpdatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => Object.fromEntries(all.map((i) => [i.id, i])) as Record<string, ItemType>, [all])

  // Mirror into the shared store so the Instrument can label replies (RE:007 · 01:52).
  useEffect(() => {
    const { upsertItem } = useData.getState()
    for (const i of all) upsertItem(i)
  }, [all])

  // Lets a reply started here round-trip through the record surface and back.
  useEffect(() => registerRiverItems(item.id, [item.id, ...all.map((i) => i.id)]), [item.id, all])

  const childrenById = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const entry of all) {
      if (!entry.parentId) continue
      const list = map[entry.parentId]
      if (list) list.push(entry.id)
      else map[entry.parentId] = [entry.id]
    }
    return map
  }, [all])

  const root = byId[item.id] ?? item
  const descendants = useMemo(
    () => (byId[item.id] ? branchOf(byId, childrenById, item.id).slice(1) : []),
    [byId, childrenById, item.id],
  )
  const replyTotal = byId[item.id] ? descendants.length : item.replyCount
  const anchors: Anchor[] = useMemo(
    () => descendants.filter((d) => d.parentId === item.id && d.anchorStartMs != null).map((d) => ({ id: d.id, ms: d.anchorStartMs! })),
    [descendants, item.id],
  )

  const openMoment = (ids: string[]) => {
    setFocusIds(new Set(ids))
    const first = ids[0]
    if (!first) return
    requestAnimationFrame(() => document.querySelector(`[data-reply-id="${first}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }))
  }

  // Local continuous playback: the post alone ("keep playing"), or post → replies
  // ("follow replies" / started on a reply). It never runs on into other River posts.
  const order = [root, ...descendants]
  const handleEnded = (currentId: string) => {
    const s = useUI.getState()
    const idx = order.findIndex((o) => o.id === currentId)
    const following = s.playbackMode === 'branch' || currentId !== root.id
    const next = following && idx >= 0 ? order.slice(idx + 1).find((o) => !!o.text || !!o.media?.length) : undefined
    if (next) return s.startPlayback(next.id)
    setTimeout(() => {
      const now = useUI.getState()
      if (now.state === 'playback' && now.activeItemId === currentId) now.setIdle()
    }, END_HOLD_MS)
  }
  const playOverride = (startId: string, follow: boolean) => {
    ui.startPlayback(startId, follow ? 'branch' : 'chronological')
  }

  const react = useSetReaction()
  const onReact = (itemId: string, type: ReactionType) => {
    const current = byId[itemId]?.reactions.find((r) => r.type === type)
    react.mutate({ itemId, type, on: !current?.reacted })
  }

  const playingId = ui.state === 'playback' && ui.activeItemId && descendants.some((d) => d.id === ui.activeItemId) ? ui.activeItemId : undefined
  const playing = playingId ? byId[playingId] : undefined
  const time = root.createdAt ? new Date(root.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

  const revealedId = useRef<string | null>(null)
  useEffect(() => {
    if (!playingId) {
      revealedId.current = null
      return
    }
    if (revealedId.current === playingId) return
    const number = byId[playingId]?.number
    if (number == null) return
    const el = document.getElementById(`item-${number}`)
    if (!el) return
    revealedId.current = playingId
    revealInSequence(el)
  }, [playingId, byId])

  return (
    <div className="river-conv" ref={cardRef} data-river-post={item.id}>
      <div className="river-conv-head">
        <button type="button" onClick={onJoin} aria-label="Enter the full room" className="title-link">
          {(item.roomTitle || 'CONVERSATION').toUpperCase()} · {time} ↗
        </button>
      </div>

      <Item
        item={root}
        replyCount={replyTotal}
        onReply={ui.startReply}
        onReact={onReact}
        onEnded={() => handleEnded(root.id)}
        onPlayOverride={(follow) => playOverride(root.id, follow)}
        anchors={anchors}
        onAnchorSelect={openMoment}
        responses={
          <ResponseMap
            parentId={root.id}
            itemsById={byId}
            childrenById={childrenById}
            activeId={playingId}
            focusIds={focusIds}
            onOpen={(id) => { if (!(ui.state === 'playback' && ui.activeItemId === id)) ui.startPlayback(id, 'branch') }}
            onReply={ui.startReply}
            onMinimize={(id) => { if (useUI.getState().activeItemId === id) useUI.getState().setIdle() }}
            renderPlayer={(entry) => (
              <Item
                item={entry}
                parentNumber={entry.parentId !== root.id ? byId[entry.parentId]?.number : undefined}
                replyCount={branchOf(byId, childrenById, entry.id).length - 1}
                onReply={ui.startReply}
                onReact={onReact}
                onEnded={() => handleEnded(entry.id)}
                onPlayOverride={(follow) => playOverride(entry.id, follow)}
                anchors={descendants.filter((d) => d.parentId === entry.id && d.anchorStartMs != null).map((d) => ({ id: d.id, ms: d.anchorStartMs! }))}
                onAnchorSelect={openMoment}
                anchorFocused={focusIds.has(entry.id)}
                slim
              />
            )}
          />
        }
      />
    </div>
  )
}
