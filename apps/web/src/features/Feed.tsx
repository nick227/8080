import { memo, useMemo, useState, useEffect, useRef } from 'react'
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
  if (idx < 0) return null
  for (let i = idx + 1; i < list.length; i++) if (hasContent(list[i])) return list[i]
  return null
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

export function Feed({ onReply, onReact }: {
  onReply: (id: string) => void
  onReact: (id: string, type: ReactionType) => void
}) {
  const data = useData()
  const items = data.orderedItems
  const ui = useUI()
  const [autoFollow, setAutoFollow] = useState(true)
  const autoFollowRef = useRef(autoFollow)
  autoFollowRef.current = autoFollow
  // A click to play often lands while the previous wheel gesture is still coasting.
  // That coast must not cancel the scroll that brings the picture into place.
  const detachHold = useRef(0)
  const holdDetach = () => { detachHold.current = performance.now() + 400 }
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
      if (performance.now() < detachHold.current) return
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
    holdDetach()
    setAutoFollow(true)
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
    holdDetach()
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
    const upcoming = new Set<string>()
    for (let i = idx + 1; i < list.length && upcoming.size < 2; i++) {
      if (hasContent(list[i])) upcoming.add(list[i].id)
    }
    return upcoming
  }, [isPlayback, ui.activeItemId, playbackMode, items, data.itemsById, data.childrenById])

  // Threads are memoised; they reach Feed's latest handlers through one stable object.
  const actionsRef = useRef<ThreadActions>(null!)
  actionsRef.current = {
    onReply,
    onReact,
    onEnded: handleEnded,
    onPlayOverride: handlePlayOverride,
    onAnchorSelect: selectAnchor,
    onOpenResponse: (id) => {
      if (useUI.getState().state === 'playback' && useUI.getState().activeItemId === id) return
      setAutoFollow(true)
      useUI.getState().startPlayback(id, 'branch')
    },
  }
  const actions = useMemo<ThreadActions>(() => ({
    onReply: (id) => actionsRef.current.onReply(id),
    onReact: (id, type) => actionsRef.current.onReact(id, type),
    onEnded: (id) => actionsRef.current.onEnded(id),
    onPlayOverride: (id, follow) => actionsRef.current.onPlayOverride(id, follow),
    onAnchorSelect: (parentId, ids) => actionsRef.current.onAnchorSelect(parentId, ids),
    onOpenResponse: (id) => actionsRef.current.onOpenResponse(id),
  }), [])

  return (
    <Panel as={motion.section} className="feed" aria-live="polite" variants={CONTAINER_VARIANTS} initial="hidden" animate="show">
      {roots.map((root) => {
        const branch = branchOf(data.itemsById, data.childrenById, root.id)
        const inBranch = (id: string | undefined) => !!id && branch.some((i) => i.id === id)
        return (
          <Thread
            key={root.id}
            root={root}
            branch={branch}
            playingId={ui.state === 'playback' && ui.activeItemId !== root.id && inBranch(ui.activeItemId) ? ui.activeItemId : undefined}
            composingHere={(ui.state === 'recording' || ui.state === 'composing') && inBranch(ui.activeItemId)}
            upcomingKey={branch.filter((i) => upcomingIds.has(i.id)).map((i) => i.id).join(' ')}
            anchorFocusKey={branch.filter((i) => anchorFocus.has(i.id)).map((i) => i.id).join(' ')}
            actions={actions}
          />
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

// ─── threads ─────────────────────────────────────────────────────────────────
// One root and its replies. Memoised: a live update or a playback step re-renders
// only the threads it touches, not the whole room. Everything a thread shows comes
// from its own items plus a few primitives derived from UI state.

const CONTAINER_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.15, delayChildren: 0.2 } },
}

const THREAD_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: 1.2, ease: [0.22, 1, 0.36, 1] } },
}

type ThreadActions = {
  onReply: (id: string) => void
  onReact: (id: string, type: ReactionType) => void
  onEnded: (id: string) => void
  onPlayOverride: (id: string, followReplies: boolean) => void
  onAnchorSelect: (parentId: string, ids: string[]) => void
  onOpenResponse: (id: string) => void
}

type ThreadProps = {
  root: ItemType
  branch: ItemType[] // root first, then replies depth-first
  playingId?: string // a reply in this thread that is playing
  composingHere: boolean
  upcomingKey: string // ids in this thread queued next (space-separated)
  anchorFocusKey: string // ids in this thread focused from an anchor marker
  actions: ThreadActions
}

function sameThread(a: ThreadProps, b: ThreadProps) {
  return a.root === b.root
    && a.playingId === b.playingId
    && a.composingHere === b.composingHere
    && a.upcomingKey === b.upcomingKey
    && a.anchorFocusKey === b.anchorFocusKey
    && a.actions === b.actions
    && a.branch.length === b.branch.length
    && a.branch.every((item, i) => item === b.branch[i])
}

const Thread = memo(function Thread({ root, branch, playingId, composingHere, upcomingKey, anchorFocusKey, actions }: ThreadProps) {
  const upcoming = new Set(upcomingKey ? upcomingKey.split(' ') : [])
  const anchorFocus = new Set(anchorFocusKey ? anchorFocusKey.split(' ') : [])
  const numberById = new Map(branch.map((i) => [i.id, i.number]))
  const anchorsByParent = new Map<string, Anchor[]>()
  for (const i of branch) {
    if (!i.parentId || i.anchorStartMs == null) continue
    const list = anchorsByParent.get(i.parentId) ?? []
    list.push({ id: i.id, ms: i.anchorStartMs })
    anchorsByParent.set(i.parentId, list)
  }
  // Read at render time: this thread re-renders whenever one of its own items changes.
  const { itemsById, childrenById } = useData.getState()

  const itemProps = (entry: ItemType) => ({
    item: entry,
    onReply: actions.onReply,
    onReact: actions.onReact,
    onEnded: () => actions.onEnded(entry.id),
    onPlayOverride: (follow: boolean) => actions.onPlayOverride(entry.id, follow),
    isUpcoming: upcoming.has(entry.id),
    anchors: anchorsByParent.get(entry.id),
    onAnchorSelect: (ids: string[]) => actions.onAnchorSelect(entry.id, ids),
    anchorFocused: anchorFocus.has(entry.id),
  })

  return (
    <motion.div className="thread" variants={THREAD_VARIANTS}>
      <Item
        {...itemProps(root)}
        parentNumber={undefined}
        replyCount={branch.length - 1}
        responses={
          <ResponseMap
            parentId={root.id}
            itemsById={itemsById}
            childrenById={childrenById}
            activeId={playingId}
            focusIds={anchorFocus}
            onOpen={actions.onOpenResponse}
            onReply={actions.onReply}
            onMinimize={(id) => { if (useUI.getState().activeItemId === id) useUI.getState().setIdle() }}
            renderPlayer={(entry) => (
              <Item
                {...itemProps(entry)}
                parentNumber={entry.parentId !== root.id ? numberById.get(entry.parentId!) : undefined}
                replyCount={branchOf(itemsById, childrenById, entry.id).length - 1}
              />
            )}
          />
        }
      />

      <AnimatePresence>
        {composingHere && (
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
}, sameThread)
