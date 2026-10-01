import { useEffect, useMemo, useRef, useState } from 'react'
import { useRoomItems, useRoomStream, useSetReaction } from '@project/sdk'
import { Item } from '../../components/Item'
import { toItem } from '../../api/adapt'
import type { Item as ItemType, ReactionType } from '../../api/types'
import { useUI } from '../../state/ui'
import { useData } from '../../state/data'
import { ancestorsOf, branchOf } from '../../utils/graph'
import { formatMoment, type Anchor } from '../../utils/anchor'
import { registerRiverItems } from './riverReply'
import './river.css'

// River-level conversation exploration for one post, without leaving the River:
// watch → notice activity (markers on the media) → open a moment's replies inline →
// watch/respond → collapse → keep scrolling. Reuses Item (playback, dwell, REPLY HERE,
// reactions, anchors) and the room's own items/stream — no River-specific API.
export type RiverPostItem = ItemType & { roomId: string; roomTitle: string; replyCount: number }

type View = { mode: 'closed' } | { mode: 'all' } | { mode: 'moment'; ids: string[]; ms: number }
const END_HOLD_MS = 1500

export function RiverConversation({ item, onJoin }: { item: RiverPostItem; onJoin: () => void }) {
  const ui = useUI()
  const cardRef = useRef<HTMLDivElement>(null)
  const branchRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false) // within ~600px: load the conversation
  const [visible, setVisible] = useState(false) // on screen: keep it live
  const [view, setView] = useState<View>({ mode: 'closed' })
  const open = view.mode !== 'closed'

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
  const roomItems = useRoomItems(near || open ? item.roomId : undefined)
  useRoomStream(visible || open ? item.roomId : undefined)
  const all = useMemo(() => (roomItems.items ?? []).map(toItem), [roomItems.dataUpdatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => Object.fromEntries(all.map((i) => [i.id, i])) as Record<string, ItemType>, [all])

  // Mirror into the shared store so the Instrument can label replies (RE:007 · 01:52).
  useEffect(() => {
    const { upsertItem } = useData.getState()
    for (const i of all) upsertItem(i)
  }, [all])

  // Lets a reply started here round-trip through the record surface and back.
  useEffect(() => registerRiverItems(item.id, [item.id, ...all.map((i) => i.id)]), [item.id, all])

  const root = byId[item.id] ?? item
  const descendants = useMemo(() => (byId[item.id] ? branchOf(byId, item.id).slice(1) : []), [byId, item.id])
  const replyTotal = byId[item.id] ? descendants.length : item.replyCount
  const anchors: Anchor[] = useMemo(
    () => descendants.filter((d) => d.parentId === item.id && d.anchorStartMs != null).map((d) => ({ id: d.id, ms: d.anchorStartMs! })),
    [descendants, item.id],
  )

  // What the open branch shows: a moment's replies (with their sub-threads), or everything.
  const shown = useMemo(() => {
    if (view.mode === 'all') return descendants
    if (view.mode !== 'moment') return []
    const keep = new Set<string>()
    for (const id of view.ids) for (const n of branchOf(byId, id)) keep.add(n.id)
    return descendants.filter((d) => keep.has(d.id))
  }, [view, descendants, byId])
  const focusIds = view.mode === 'moment' ? new Set(view.ids) : new Set<string>()

  const reveal = () => requestAnimationFrame(() => branchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  const openMoment = (ids: string[], ms: number) => { setView({ mode: 'moment', ids, ms }); reveal() }
  const openAll = () => { setView({ mode: 'all' }); reveal() }
  const collapse = () => {
    if (ui.activeItemId && shown.some((s) => s.id === ui.activeItemId)) ui.setIdle()
    setView({ mode: 'closed' })
    // Keep the reader where they were: bring the post back if the branch scrolled it away.
    requestAnimationFrame(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  // Local continuous playback: the post alone ("keep playing"), or post → shown replies
  // ("follow replies" / started on a reply). It never runs on into other River posts.
  const order = [root, ...shown]
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
    if (follow && view.mode === 'closed') setView({ mode: 'all' })
    ui.startPlayback(startId, follow ? 'branch' : 'chronological')
  }

  const react = useSetReaction()
  const onReact = (itemId: string, type: ReactionType) => {
    const current = byId[itemId]?.reactions.find((r) => r.type === type)
    react.mutate({ itemId, type, on: !current?.reacted })
  }

  const live = !!ui.activeItemId && shown.some((s) => s.id === ui.activeItemId)
  const time = root.createdAt ? new Date(root.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div className="river-conv" ref={cardRef} data-river-post={item.id}>
      <div className="river-conv-head">
        <button type="button" onClick={onJoin}>{(item.roomTitle || 'CONVERSATION').toUpperCase()} · {time}</button>
        <button type="button" onClick={onJoin} aria-label="Enter the full room">ENTER ROOM ↗</button>
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
      />

      <div className="river-conv-bar">
        {view.mode === 'closed' && replyTotal > 0 && (
          <button type="button" onClick={openAll} aria-expanded={false}>↳ {replyTotal} {replyTotal === 1 ? 'REPLY' : 'REPLIES'}</button>
        )}
        {view.mode === 'moment' && (
          <>
            <span className="river-conv-moment">↳ {view.ids.length} AT {formatMoment(view.ms)}</span>
            {replyTotal > view.ids.length && <button type="button" onClick={openAll}>SHOW ALL {replyTotal}</button>}
          </>
        )}
        {open && <button type="button" onClick={collapse} aria-expanded>— COLLAPSE</button>}
      </div>

      {open && (
        <div className="river-conv-branch" ref={branchRef} data-live={live || undefined}>
          {shown.map((child) => {
            const depth = ancestorsOf(byId, child.id).length
            const parent = child.parentId ? byId[child.parentId] : undefined
            return (
              <div key={child.id} className="river-conv-node" style={{ ['--depth' as string]: Math.min(depth - 1, 3) }}>
                <Item
                  item={child}
                  parentNumber={child.parentId !== root.id ? parent?.number : undefined}
                  replyCount={branchOf(byId, child.id).length - 1}
                  onReply={ui.startReply}
                  onReact={onReact}
                  onEnded={() => handleEnded(child.id)}
                  onPlayOverride={(follow) => playOverride(child.id, follow)}
                  anchors={descendants.filter((d) => d.parentId === child.id && d.anchorStartMs != null).map((d) => ({ id: d.id, ms: d.anchorStartMs! }))}
                  onAnchorSelect={openMoment}
                  anchorFocused={focusIds.has(child.id)}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
