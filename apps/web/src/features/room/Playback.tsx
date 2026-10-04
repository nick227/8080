import { useEffect, useRef } from 'react'
import { PersonName, nameWithTag } from '../../components/PersonName'
import type { Item } from '../../api/types'
import { Media } from '../../components/Media'
import { dwellMs, getWaveform } from '../../components/Item'
import { controllerWithin } from '../../media/controller'

const PLAYABLE = new Set(['audio', 'video'])

// Chat items stay in the chat: never part of Play All or stage advance (doc/08 I3).
export function isPlayable(item: Item) {
  if (item.chat) return false
  return item.media?.some((media) => PLAYABLE.has(media.type) && media.embeddable !== false) ?? false
}

export function Playback({ item, onClose, onEnded, onReply }: {
  item: Item
  onClose: () => void
  onEnded: () => void
  onReply: () => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const media = item.media?.find((entry) => PLAYABLE.has(entry.type) && entry.embeddable !== false) ?? item.media?.[0]
  const playable = !!media && PLAYABLE.has(media.type) && media.embeddable !== false
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded

  useEffect(() => {
    if (playable) return
    const timer = window.setTimeout(() => onEndedRef.current(), media ? dwellMs(item) : 0)
    return () => window.clearTimeout(timer)
  }, [playable, item, media])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const replay = () => {
    const ctrl = controllerWithin(stageRef.current)
    if (!ctrl) return
    ctrl.seek(0)
    void ctrl.play()
  }

  const initial = (item.author.name.trim().charAt(0) || '?').toUpperCase()

  return (
    <div className="room-stage" role="dialog" aria-label={`Playing ${nameWithTag(item.author.name, item.author.tag)}`}>
      <div className="room-stage-bar">
        <span className="room-byline">
          <span className="room-avatar" data-photo={item.author.avatarUrl ? '' : undefined}>
            {item.author.avatarUrl ? <img src={item.author.avatarUrl} alt="" /> : initial}
          </span>
          <PersonName className="room-who" name={item.author.name} tag={item.author.tag} />
        </span>
        <div className="room-actions">
          {playable && <button type="button" onClick={replay}>Replay</button>}
          <button type="button" onClick={onReply}>Reply</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="room-stage-body" ref={stageRef}>
        {media?.type === 'image' && <img src={media.url} alt={media.name ?? ''} />}
        {media && media.type !== 'image' && (
          <Media
            type={media.type}
            src={media.url}
            poster={media.poster}
            name={media.name ?? media.title}
            title={media.title}
            embeddable={media.embeddable}
            waveform={media.type === 'audio' ? getWaveform(item.id) : undefined}
            isActive={playable}
            onEnded={onEnded}
          />
        )}
        {!media && item.text && <p className="room-card">{item.text}</p>}
      </div>
    </div>
  )
}
