import { useMemo, useState, useEffect, useRef } from 'react'
import type { Item as ItemType, ReactionType } from '../api/types'
import { Item } from '../components/Item'
import { Panel } from '../components/Panel'
import { useData, selectAllItems, type ItemsById } from '../state/data'
import { useUI } from '../state/ui'
import { ancestorsOf, branchOf } from '../utils/graph'
import { ResponseMap } from './ResponseMap'
import { itemElement, revealInSequence, directionTo, isBackInView, haltFollowScroll } from '../utils/reveal'
import { Control } from '../components/Control'
import type { Anchor } from '../utils/anchor'
import { motion, AnimatePresence, type Variants } from 'motion/react'
import { Instrument } from './Instrument'
import type { SendInput } from '../api/types'

const label = (n: number) => String(n).padStart(3, '0')
const END_HOLD_MS = 1500
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '])

// Tombstoned placements have nothing to show or play; traversal steps over them.
const hasContent = (i: ItemType) => !!i.text || !!i.media?.length

// Top of the thread containing `id` (parentId alone is only one level up).
const threadRootOf = (byId: ItemsById, id: string) => ancestorsOf(byId, id).at(-1)?.id ?? id

// The playback order for `mode`, read from the live store (so items that arrived
// over SSE since the last render are included).
function traversal(mode: 'chronological' | 'branch', fromId: string): ItemType[] {
  const data = useData.getState()
  if (mode === 'branch') return branchOf(data.itemsById, data.childrenById, threadRootOf(data.itemsById, fromId))
  return selectAllItems(data)
}

function nextInTraversal(mode: 'chronological' | 'branch', currentId: string): ItemType | null {
  const list = traversal(mode, currentId)
  const idx = list.findIndex((i) => i.id === currentId)
  return idx < 0 ? null : list.slice(idx + 1).find(hasContent) ?? null
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

export function Feed({ items, onReply, onReact, onSend }: {
  items: ItemType[]
  onReply: (id: string) => void
  onReact: (id: string, type: ReactionType) => void
  onSend: (input: SendInput) => Promise<void>
}) {
  const data = useData()
  const ui = useUI()
  const [autoFollow, setAutoFollow] = useState(true)
  const autoFollowRef = useRef(autoFollow)
  autoFollowRef.current = autoFollow
  const [returnDir, setReturnDir] = useState<ReturnType<typeof directionTo>>(null)
  const playbackMode = ui.playbackMode ?? 'chronological'
  const isPlayback = ui.state === 'playback'

  const { roots, numberById } = useMemo(() => {
    const rootList: ItemType[] = []
    const map = new Map<string, number>()
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      map.set(item.id, item.number)
      if (!item.parentId) rootList.push(item)
    }
    return { roots: rootList, numberById: map }
  }, [items])

  const activeNumber = ui.activeItemId ? numberById.get(ui.activeItemId) : undefined

  // ─── manual detach ─────────────────────────────────────────────────────────
  // Any user scroll gesture during playback detaches the view from the playhead;
  // playback itself continues. Programmatic (follow) scrolling never detaches.
  useEffect(() => {
    if (!isPlayback) {
      setAutoFollow(true)
      return
    }
    const detach = () => {
      if (autoFollowRef.current) haltFollowScroll(document.querySelector('.feed'))
      setAutoFollow(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key) && !isTyping(e.target)) detach()
    }
    window.addEventListener('wheel', detach, { passive: true })
    window.addEventListener('touchmove', detach, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', detach)
      window.removeEventListener('touchmove', detach)
      window.removeEventListener('keydown', onKey)
    }
  }, [isPlayback])

  // While detached: point the return control at the playhead, and re-attach on
  // its own once the user scrolls the playing item back into view (after having
  // left it) — no click needed to resume following. Visibility is judged against
  // what's actually visible (the timeline clips inside the page shell).
  useEffect(() => {
    if (!isPlayback || autoFollow || activeNumber == null) return
    const el = itemElement(activeNumber)
    if (!el) return
    let away = !isBackInView(el)
    const update = () => {
      setReturnDir(directionTo(el))
      if (!isBackInView(el)) away = true
      else if (away) setAutoFollow(true)
    }
    update()
    window.addEventListener('scroll', update, { passive: true, capture: true }) // capture: .feed scrolls too
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, { capture: true })
      window.removeEventListener('resize', update)
    }
  }, [isPlayback, autoFollow, activeNumber])

  const returnToPlayback = () => {
    setAutoFollow(true)
    if (activeNumber != null) {
      const node = itemElement(activeNumber)
      if (node) revealInSequence(node)
    }
  }

  // ─── follow the playhead ───────────────────────────────────────────────────
  // One short scroll per newly active item, aimed at that item's own picture.
  const revealedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isPlayback) {
      revealedRef.current = null
      return
    }
    if (!autoFollow || activeNumber == null || !ui.activeItemId) return
    if (revealedRef.current === ui.activeItemId) return
    const el = itemElement(activeNumber)
    if (!el) return
    const id = ui.activeItemId
    revealedRef.current = id
    revealInSequence(el)
    return () => { if (revealedRef.current === id) revealedRef.current = null }
  }, [isPlayback, ui.activeItemId, activeNumber, autoFollow])

  // ─── anchored replies ──────────────────────────────────────────────────────
  // Moments in a parent's media that replies attach to (parentId → anchors).
  const anchorsByParent = useMemo(() => {
    const map = new Map<string, Anchor[]>()
    for (const i of items) {
      if (!i.parentId || i.anchorStartMs == null) continue
      const list = map.get(i.parentId)
      if (list) list.push({ id: i.id, ms: i.anchorStartMs })
      else map.set(i.parentId, [{ id: i.id, ms: i.anchorStartMs }])
    }
    return map
  }, [items])

  // Tapping a marker opens that local branch and shows the replies attached there.
  // No playback change. Focus clears as soon as the UI moves on (play, reply, …).
  const [anchorFocus, setAnchorFocus] = useState<Set<string>>(new Set())
  useEffect(() => { setAnchorFocus(new Set()) }, [ui.state])
  const selectAnchor = (_parentId: string, ids: string[]) => {
    setAnchorFocus(new Set(ids))
    const first = ids[0]
    if (!first) return
    requestAnimationFrame(() => document.querySelector(`[data-reply-id="${first}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }))
  }

  // ─── continuous playback ───────────────────────────────────────────────────
  const handlePlayOverride = (startId: string, followReplies: boolean) => {
    setAutoFollow(true) // an explicit play re-attaches the view
    ui.startPlayback(startId, followReplies ? 'branch' : 'chronological')
  }

  const handleEnded = (currentId: string) => {
    const mode = useUI.getState().playbackMode ?? 'chronological'
    const next = nextInTraversal(mode, currentId)
    if (next) {
      ui.startPlayback(next.id)
      return
    }
    // End of the traversal: hold on the last item briefly. If something new arrives
    // meanwhile (SSE), continue into it; otherwise go idle. Only act if playback is
    // still on this item — the user may have started something else.
    setTimeout(() => {
      const s = useUI.getState()
      if (s.state !== 'playback' || s.activeItemId !== currentId) return
      const late = nextInTraversal(mode, currentId)
      if (late) s.startPlayback(late.id)
      else s.setIdle()
    }, END_HOLD_MS)
  }

  // Preload the next 2 playable items
  const upcomingIds = useMemo(() => {
    if (!isPlayback || !ui.activeItemId) return new Set<string>()
    let list = items
    if (playbackMode === 'branch') {
      const current = data.itemsById[ui.activeItemId]
      if (current) list = branchOf(data.itemsById, data.childrenById, threadRootOf(data.itemsById, current.id))
    }
    const idx = list.findIndex(i => i.id === ui.activeItemId)
    if (idx < 0) return new Set<string>()
    return new Set(list.slice(idx + 1).filter(hasContent).slice(0, 2).map((i) => i.id))
  }, [isPlayback, ui.activeItemId, playbackMode, items, data.itemsById])

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.2
      }
    }
  }

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 40 },
    show: { 
      opacity: 1, 
      y: 0,
      transition: { duration: 1.2, ease: [0.22, 1, 0.36, 1] } 
    }
  }

  return (
    <Panel as={motion.section} className="feed" aria-live="polite" variants={containerVariants} initial="hidden" animate="show">
      {roots.map(root => {
        const branch = branchOf(data.itemsById, data.childrenById, root.id)
        const replyCount = branch.length - 1
        const playingId = ui.state === 'playback' && ui.activeItemId && branch.some((i) => i.id === ui.activeItemId && i.id !== root.id) ? ui.activeItemId : undefined
        const playResponse = (id: string) => {
          if (ui.state === 'playback' && ui.activeItemId === id) return
          setAutoFollow(true)
          ui.startPlayback(id, 'branch')
        }
        const playerFor = (entry: ItemType) => (
          <Item
            item={entry}
            parentNumber={entry.parentId !== root.id ? numberById.get(entry.parentId!) : undefined}
            replyCount={branchOf(data.itemsById, data.childrenById, entry.id).length - 1}
            onReply={onReply}
            onReact={onReact}
            onEnded={() => handleEnded(entry.id)}
            onPlayOverride={(follow) => handlePlayOverride(entry.id, follow)}
            isUpcoming={upcomingIds.has(entry.id)}
            anchors={anchorsByParent.get(entry.id)}
            onAnchorSelect={(ids) => selectAnchor(entry.id, ids)}
            anchorFocused={anchorFocus.has(entry.id)}
          />
        )

        return (
          <motion.div 
            key={root.id} 
            className="thread"
            variants={itemVariants}
          >
            <Item
              item={root}
              parentNumber={undefined}
              replyCount={replyCount}
              onReply={onReply}
              onReact={onReact}
              onEnded={() => handleEnded(root.id)}
              onPlayOverride={(follow) => handlePlayOverride(root.id, follow)}
              isUpcoming={upcomingIds.has(root.id)}
              anchors={anchorsByParent.get(root.id)}
              onAnchorSelect={(ids) => selectAnchor(root.id, ids)}
              anchorFocused={anchorFocus.has(root.id)}
              responses={
                <ResponseMap
                  parentId={root.id}
                  itemsById={data.itemsById}
                  childrenById={data.childrenById}
                  activeId={playingId}
                  focusIds={anchorFocus}
                  onOpen={playResponse}
                  onReply={onReply}
                  onMinimize={(id) => { if (useUI.getState().activeItemId === id) useUI.getState().setIdle() }}
                  renderPlayer={playerFor}
                />
              }
            />
            
            <AnimatePresence>
              {(ui.state === 'recording' || ui.state === 'composing') && ui.activeItemId && branch.some(i => i.id === ui.activeItemId) && (
                <motion.div
                  initial={{ opacity: 0, height: 0, scale: 0.9 }}
                  animate={{ opacity: 1, height: 'auto', scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.9 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  style={{ marginBottom: 32 }}
                >
                  <div style={{ height: 120, width: '100%', maxWidth: 400, borderRadius: 24, border: '1px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.08em' }}>[ ◉ /// ]</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )
      })}

      <AnimatePresence>
        {(ui.state === 'recording' || ui.state === 'composing') && !ui.activeItemId && (
          <motion.div
            initial={{ opacity: 0, height: 0, scale: 0.9 }}
            animate={{ opacity: 1, height: 'auto', scale: 1 }}
            exit={{ opacity: 0, height: 0, scale: 0.9 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            style={{ marginBottom: 56 }}
          >
            <div style={{ height: 120, width: '100%', maxWidth: 400, borderRadius: 24, border: '1px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.08em' }}>[ ◉ /// ]</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isPlayback && !autoFollow && activeNumber != null && !data.itemsById[ui.activeItemId ?? '']?.parentId && (
          <motion.div
            className="return-to-playback"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            style={{ x: '-50%' }}
          >
            <Control variant="default" onClick={returnToPlayback} aria-label={`Return to playback at item ${label(activeNumber)}`}>
              <span aria-hidden className="return-dir">{returnDir ?? '◉'}</span> RETURN TO {label(activeNumber)}
            </Control>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}
