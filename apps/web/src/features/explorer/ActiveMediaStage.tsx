import { useRef } from 'react'
import type { Item as ItemType } from '../../api/types'
import { Media } from '../../components/Media'
import { dwellMs } from '../../components/Item'
import { Control } from '../../components/Control'
import { useUI } from '../../state/ui'
import { useData } from '../../state/data'
import { controllerWithin } from '../../media/controller'
import { anchorableMedia, formatMoment } from '../../utils/anchor'
import { useEffect, useState } from 'react'
import { Label } from '../../components/Label'
import { MediaTimeline } from './MediaTimeline'

const PLAYABLE = new Set(['audio', 'video'])

export function ActiveMediaStage({ item, onReply, onEnded }: {
  item: ItemType
  onReply: () => void
  onEnded: () => void
}) {
  const ui = useUI()
  const data = useData()
  const ref = useRef<HTMLDivElement>(null)
  
  // The state 'playback' makes the media play. The active stage is implicitly active.
  // Actually, in the old Feed, isActive was ui.state === 'playback' && ui.activeItemId === item.id
  // Here, if it's the active stage, it's always the focus. We can start playback automatically
  // if ui.state is 'playback'.
  const isActive = ui.state === 'playback' && ui.activeItemId === item.id
  
  const playable = item.media?.some((m) => PLAYABLE.has(m.type) && m.embeddable !== false) ?? false
  const empty = !item.text && !item.media?.length
  const anchorable = anchorableMedia(item)

  const replyHere = () => {
    if (!anchorable) {
      return onReply()
    }
    const now = controllerWithin(ref.current)?.getCurrentTimeMs() ?? 0
    const limit = Math.round((anchorable.duration ?? 0) * 1000)
    const ms = Math.min(limit, Math.max(0, now))
    ui.startReply(item.id, ms)
  }

  // Auto advance non-playable (text) items
  const [held, setHeld] = useState(false)
  const remainingRef = useRef<number | null>(null)
  const dwelling = isActive && !playable && !empty
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded

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
  }, [dwelling, held])

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
    ui.startPlayback(item.id)
  }

  // Gather anchors for the timeline (replies to this item)
  const children = (data.childrenById[item.id] ?? []).map(id => data.itemsById[id])
  const anchors = children.filter(c => c && c.anchorStartMs != null).map(c => ({ id: c.id, ms: c.anchorStartMs! }))

  return (
    <div className="active-media-stage" ref={ref} {...holdHandlers}>
      <div className="stage-content">
        {dwelling && held && <Label variant="status" aria-live="polite">HELD</Label>}
        {item.text && <div className="stage-text">{item.text}</div>}
        
        {item.media?.map(media => (
          <div key={media.id} className="stage-media-wrapper">
            <Media
              type={media.type}
              src={media.url}
              poster={media.poster}
              name={media.name}
              title={media.title}
              embeddable={media.embeddable}
              isActive={isActive}
              onEnded={onEnded}
              onRequestPlay={requestPlay}
              waveform={media.type === 'audio' ? [] : undefined} // simplified waveform
            />
            {anchorable && media.id === anchorable.id && (
              <MediaTimeline 
                anchors={anchors} 
                durationMs={Math.round((anchorable.duration ?? 0) * 1000)}
                onSelect={(ids) => {
                  if (ids.length > 0) {
                    ui.startPlayback(ids[0], 'branch')
                  }
                }}
              />
            )}
          </div>
        ))}
      </div>
      
      <div className="stage-actions">
        <span className="stage-meta">{item.media?.[0]?.title || item.media?.[0]?.name || 'TEXT'}</span>
        <Control onClick={replyHere}>{anchorable ? 'REPLY HERE' : 'REPLY'}</Control>
      </div>
    </div>
  )
}
