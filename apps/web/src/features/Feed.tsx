import { useMemo, useState, useEffect, useRef } from 'react'
import type { Item as ItemType, ReactionType } from '../api/types'
import { Item } from '../components/Item'
import { Panel } from '../components/Panel'
import { useData, selectAllItems, type ItemsById } from '../state/data'
import { useUI } from '../state/ui'
import { ancestorsOf, branchOf } from '../utils/graph'
import { itemElement, revealItem, directionTo, isBackInView, haltFollowScroll } from '../utils/reveal'
import { Control } from '../components/Control'
import type { Anchor } from '../utils/anchor'
import { motion, AnimatePresence, type Variants } from 'motion/react'

const label = (n: number) => String(n).padStart(3, '0')
const BRANCH_EXPAND_MS = 400
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
  if (mode === 'branch') return branchOf(data.itemsById, threadRootOf(data.itemsById, fromId))
  return selectAllItems(data)
}

function nextInTraversal(mode: 'chronological' | 'branch', currentId: string): ItemType | null {
  const list = traversal(mode, currentId)
  const idx = list.findIndex((i) => i.id === currentId)
  return idx < 0 ? null : list.slice(idx + 1).find(hasContent) ?? null
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

export function Feed({ items, onReply, onReact }: {
  items: ItemType[]
  onReply: (id: string) => void
  onReact: (id: string, type: ReactionType) => void
}) {
  const data = useData()
  const ui = useUI()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
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
    if (activeNumber != null) revealItem(itemElement(activeNumber))
  }

  // ─── follow the playhead ───────────────────────────────────────────────────
  // Reveal each newly active item once (both axes: desktop timeline + mobile feed).
  // If its branch is still mounting, this re-runs when expandedIds changes; a
  // second reveal after the expand animation corrects for the shifted layout.
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
    revealItem(el)
    const settle = setTimeout(() => {
      if (useUI.getState().activeItemId === id && autoFollowRef.current) revealItem(itemElement(activeNumber))
    }, BRANCH_EXPAND_MS + 50)
    return () => clearTimeout(settle)
  }, [isPlayback, ui.activeItemId, activeNumber, autoFollow, expandedIds])

  // ─── branches ──────────────────────────────────────────────────────────────
  const toggleExpand = (id: string) => {
    // Branch collapse protection
    if (ui.state === 'playback' && ui.activeItemId && expandedIds.has(id)) {
      const branch = branchOf(data.itemsById, id)
      if (branch.some(i => i.id === ui.activeItemId)) {
        return // Do not allow collapsing the actively playing branch
      }
    }
    
    const next = new Set(expandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedIds(next)
  }

  // Auto-expand the thread containing the active item. Threads are keyed by their
  // root, so expand the root — not the direct parent (deep replies would otherwise
  // never mount, and an unmounted audio item never fires `ended`).
  useEffect(() => {
    if (!ui.activeItemId) return
    const active = data.itemsById[ui.activeItemId]
    if (!active?.parentId) return
    const rootId = threadRootOf(data.itemsById, active.id)
    setExpandedIds((prev) => (prev.has(rootId) ? prev : new Set(prev).add(rootId)))
  }, [ui.activeItemId, data.itemsById])


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
  const selectAnchor = (parentId: string, ids: string[]) => {
    const rootId = threadRootOf(data.itemsById, parentId)
    setExpandedIds((prev) => (prev.has(rootId) ? prev : new Set(prev).add(rootId)))
    setAnchorFocus(new Set(ids))
    const first = data.itemsById[ids[0]!]
    if (first) setTimeout(() => revealItem(itemElement(first.number)), BRANCH_EXPAND_MS + 50)
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
      if (current) list = branchOf(data.itemsById, threadRootOf(data.itemsById, current.id))
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
        const branch = branchOf(data.itemsById, root.id)
        const replyCount = branch.length - 1
        const isExpanded = expandedIds.has(root.id)
        const holdsPlayhead = isPlayback && !!ui.activeItemId && branch.some((i) => i.id === ui.activeItemId)

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
            />
            
            {replyCount > 0 && !isExpanded && (
              <Control className="thread-toggle" aria-expanded={false} onClick={() => toggleExpand(root.id)}>
                ↳ {replyCount} {replyCount === 1 ? 'REPLY' : 'REPLIES'}
              </Control>
            )}

            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div 
                  className="branch"
                  data-live={holdsPlayhead || undefined}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: BRANCH_EXPAND_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Control className="thread-toggle" aria-expanded onClick={() => toggleExpand(root.id)} disabled={holdsPlayhead} title={holdsPlayhead ? 'Playing in this thread' : undefined}>
                    — COLLAPSE
                  </Control>
                  
                  {branch.slice(1).map(child => {
                    // Depth below the root (1 = direct reply); indentation is capped so
                    // deep threads stay inside the column.
                    const depth = ancestorsOf(data.itemsById, child.id).length
                    return (
                      <div key={child.id} className="branch-node" style={{ ['--depth' as string]: Math.min(depth - 1, 3) }}>
                        <Item
                          item={child}
                          // Only pass parentNumber if this child is deeply nested (i.e. not a direct reply to root)
                          parentNumber={child.parentId !== root.id ? numberById.get(child.parentId!) : undefined}
                          replyCount={branchOf(data.itemsById, child.id).length - 1}
                          onReply={onReply}
                          onReact={onReact}
                          onEnded={() => handleEnded(child.id)}
                          onPlayOverride={(follow) => handlePlayOverride(child.id, follow)}
                          isUpcoming={upcomingIds.has(child.id)}
                          anchors={anchorsByParent.get(child.id)}
                          onAnchorSelect={(ids) => selectAnchor(child.id, ids)}
                          anchorFocused={anchorFocus.has(child.id)}
                        />
                      </div>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>
            
            <AnimatePresence>
              {(ui.state === 'recording' || ui.state === 'composing') && ui.activeItemId && branch.some(i => i.id === ui.activeItemId) && (
                <motion.div
                  initial={{ opacity: 0, height: 0, scale: 0.9 }}
                  animate={{ opacity: 1, height: 'auto', scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.9 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  style={{ marginLeft: '8vw', marginBottom: 32, paddingLeft: 24, borderLeft: '1px solid var(--line)' }}
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
        {isPlayback && !autoFollow && activeNumber != null && (
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
