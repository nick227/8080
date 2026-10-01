import type { Item as ItemType, ReactionType } from '../api/types'
import { Control } from './Control'
import { Media } from './Media'
import { Panel } from './Panel'
import { Stack } from './Stack'
import { Label } from './Label'
import { useUI } from '../state/ui'
import { useData } from '../state/data'
import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { ShareMenu } from './ShareMenu'
import { anchorableMedia, formatMoment, type Anchor } from '../utils/anchor'
import { controllerWithin } from '../media/controller'

type Props = {
  item: ItemType
  parentNumber?: number
  replyCount?: number
  onReply: (id: string) => void
  onReact: (id: string, type: ReactionType) => void
  onEnded?: () => void
  onPlayOverride?: (followReplies: boolean) => void
  isUpcoming?: boolean
  // Anchored replies attached to moments in this item's media, and what tapping one does.
  anchors?: Anchor[]
  onAnchorSelect?: (ids: string[], ms: number) => void
  anchorFocused?: boolean
  // Thumbnail map of replies, rendered directly under this item's media.
  responses?: ReactNode
  // A response grown in the sequence: no headline. Title and author sit under the video.
  slim?: boolean
}

const label = (n: number) => String(n).padStart(3, '0')

// True when `itemId` is an ancestor of the current playhead. The playhead's
// container must stay full strength — dimming it grays the nested video with it.
function containsPlayhead(itemId: string, activeId: string | null): boolean {
  if (!activeId || activeId === itemId) return false
  const byId = useData.getState().itemsById
  let current = byId[activeId]?.parentId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    if (current === itemId) return true
    seen.add(current)
    current = byId[current]?.parentId
  }
  return false
}

function responseMeta(item: ItemType): { title: string; detail: string } {
  const media = item.media?.find((m) => m.type === 'video' || m.type === 'audio') ?? item.media?.[0]
  const title = media?.title || media?.name || item.text || 'Response'
  const detail = [item.author.name]
  if (item.anchorStartMs != null) detail.push(formatMoment(item.anchorStartMs))
  const made = new Date(item.createdAt)
  if (!Number.isNaN(made.getTime())) detail.push(made.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  if (media?.duration) detail.push(formatMoment(Math.round(media.duration * 1000)))
  return { title, detail: detail.join(' · ') }
}

// Items without audio/video never fire `ended`, so they must explicitly take part
// in playback: dwell for a reading-time beat, then advance (otherwise traversal
// stalls on text/images/files). Interaction holds the dwell; leaving resumes it.
const PLAYABLE = new Set(['audio', 'video'])
const DWELL = { minMs: 2000, perCharMs: 60, maxMs: 7500, stillMs: 2750 }

export function dwellMs(item: Pick<ItemType, 'text' | 'media'>): number {
  const chars = item.text?.trim().length ?? 0
  const textMs = chars ? Math.min(DWELL.maxMs, Math.max(DWELL.minMs, chars * DWELL.perCharMs)) : 0
  const hasStill = item.media?.some((m) => m.type === 'image' || m.type === 'file') ?? false
  return Math.max(textMs, hasStill ? DWELL.stillMs : 0, DWELL.minMs)
}

export function Item({ item, parentNumber, replyCount = 0, onReply, onReact, onEnded, onPlayOverride, isUpcoming, anchors, onAnchorSelect, anchorFocused, responses, slim }: Props) {
  const [showPlayOptions, setShowPlayOptions] = useState(false)
  const [showShareMenu, setShowShareMenu] = useState(false)
  const count = (type: ReactionType) => item.reactions.find(r => r.type === type)?.count
  const ui = useUI()
  const isActive = ui.state === 'playback' && ui.activeItemId === item.id
  const meta = slim ? responseMeta(item) : null
  const ref = useRef<HTMLDivElement>(null)
  // Inline-playable media fires `ended`; a YouTube link card (not embeddable) doesn't,
  // so it takes part in playback through the dwell like text/images.
  const playable = item.media?.some((m) => PLAYABLE.has(m.type) && m.embeddable !== false) ?? false
  const empty = !item.text && !item.media?.length // tombstoned placement
  const anchorable = anchorableMedia(item)

  // REPLY HERE: capture the moment *now* (when chosen), from the element actually
  // playing — not at Send, so a long recorded reply can't drift the anchor forward.
  const replyHere = () => {
    if (!anchorable) return
    // Same question for every source (stored <video>/<audio> or YouTube): where is it now?
    const now = controllerWithin(ref.current)?.getCurrentTimeMs() ?? 0
    const limit = Math.round((anchorable.duration ?? 0) * 1000)
    const ms = Math.min(limit, Math.max(0, now))
    ui.startReply(item.id, ms)
  }

  // Spatial focus while playing or replying: the focused item stays full-strength,
  // the next one is half-lit, everything else recedes (styled via [data-focus]).
  const focusing = (ui.state === 'playback' || ui.state === 'replying') && !!ui.activeItemId
  const nestedHere = focusing && containsPlayhead(item.id, ui.activeItemId ?? null)
  const focus = !focusing || nestedHere
    ? undefined
    : ui.activeItemId === item.id
      ? (ui.state === 'playback' ? 'active' : 'target')
      : isUpcoming ? 'upcoming' : 'receded'

  // Latest callback in a ref: Feed passes a new closure every render, and re-renders
  // (e.g. an SSE update) must not restart the dwell timer.
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded

  // Dwell with hold/resume: `remaining` survives a hold so resuming continues the
  // countdown instead of restarting it; it resets whenever the item stops being active.
  const [held, setHeld] = useState(false)
  const remainingRef = useRef<number | null>(null)
  const dwelling = isActive && !playable && !empty

  // Nothing to show or play (deleted while queued or while playing): advance now.
  useEffect(() => {
    if (!isActive || !empty) return
    const t = setTimeout(() => onEndedRef.current?.(), 0)
    return () => clearTimeout(t)
  }, [isActive, empty])
  useEffect(() => {
    if (!dwelling) {
      remainingRef.current = null
      setHeld(false)
      return
    }
    remainingRef.current ??= dwellMs(item)
    if (held) return
    const startedAt = performance.now()
    const timer = setTimeout(() => {
      remainingRef.current = null
      onEndedRef.current?.()
    }, remainingRef.current)
    return () => {
      clearTimeout(timer)
      if (remainingRef.current != null) {
        remainingRef.current = Math.max(0, remainingRef.current - (performance.now() - startedAt))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dwelling, held])

  // Mouse: hover holds — but only real pointer movement counts. Follow-scrolling
  // brings the active item under a resting cursor, and the browser then fires
  // synthetic enter/move events with zero movement; that is not the user
  // interacting, and must not freeze continuous playback.
  // Keyboard: focus within holds. Touch (no hover): tap toggles.
  const holdHandlers = {
    onPointerMove: (e: React.PointerEvent) => {
      if (dwelling && !held && e.pointerType === 'mouse' && (e.movementX !== 0 || e.movementY !== 0)) setHeld(true)
    },
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHeld(false) },
    onPointerDown: (e: React.PointerEvent) => { if (dwelling && e.pointerType !== 'mouse') setHeld((h) => !h) },
    onFocus: () => { if (dwelling) setHeld(true) },
    onBlur: (e: React.FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false) },
  }

  const requestPlay = () => {
    if (isActive) return ui.setIdle()
    if (onPlayOverride) onPlayOverride(true)
    else ui.startPlayback(item.id)
  }

  return (
    <Panel as="article" variant="item" id={`item-${item.number}`} ref={ref} data-focus={focus} data-anchor-focus={anchorFocused || undefined} aria-current={focus === 'active' ? 'true' : undefined} {...holdHandlers}>
      <Stack className="item-body">

        {dwelling && held && <Label variant="status" aria-live="polite">HELD</Label>}
        {!slim && (item.anchorStartMs != null ? (
          <Label variant="reference">{parentNumber != null ? `RE:${label(parentNumber)} · ` : 'AT '}{formatMoment(item.anchorStartMs)}</Label>
        ) : parentNumber != null && <Label variant="reference">RE:{label(parentNumber)}</Label>)}
        {!slim && item.text && <Label variant="caption">{item.text}</Label>}
        {item.media?.map(media => (
          <Media
            key={media.id}
            type={media.type}
            src={media.url}
            poster={media.poster}
            name={media.name}
            title={media.title}
            embeddable={media.embeddable}
            isActive={isActive}
            onEnded={onEnded}
            onRequestPlay={requestPlay}
            isUpcoming={isUpcoming}
            {...(anchorable && media.id === anchorable.id
              ? { anchors, anchorDurationMs: Math.round((anchorable.duration ?? 0) * 1000), activeAnchorId: ui.state === 'playback' ? ui.activeItemId : undefined, onAnchorSelect }
              : {})}
          />
        ))}
        {meta && (
          <p className="response-meta">
            <span className="response-meta-title">{meta.title}</span>
            <span>{meta.detail}</span>
          </p>
        )}

        <Stack direction="row" gap="medium" className="item-actions" aria-label={`Actions for item ${label(item.number)}`}>
          <Control aria-label={`Like, ${count('like') ?? 0} likes`} onClick={() => onReact(item.id, 'like')}>♥ {count('like') ?? ''}</Control>
          <Control aria-label={`Acknowledge, ${count('ack') ?? 0} acknowledgements`} onClick={() => onReact(item.id, 'ack')}>+1 {count('ack') ?? ''}</Control>
          <Control aria-label={`Laugh, ${count('laugh') ?? 0} laughs`} onClick={() => onReact(item.id, 'laugh')}>:) {count('laugh') ?? ''}</Control>
          <Control aria-label={`Reply to item ${label(item.number)}`} onClick={() => onReply(item.id)}>REPLY</Control>
          <Control aria-label={`Share item ${label(item.number)} to other rooms`} onClick={() => {
            setShowShareMenu(!showShareMenu)
            setShowPlayOptions(false)
          }}>SHARE</Control>
        </Stack>
        
        {showShareMenu && !isActive && (
          <ShareMenu messageId={item.messageId} onClose={() => setShowShareMenu(false)} />
        )}
        

        {responses}
      </Stack>
    </Panel>
  )
}
