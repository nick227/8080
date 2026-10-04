import { useEffect, useRef, useState } from 'react'
import type { Item, Media } from '../../api/types'
import { ViewSwitch } from './ViewSwitch'
import type { RoomView } from './roomViews'

function direct(item: Item): Media | undefined {
  return item.media?.find((media) => (media.type === 'video' || media.type === 'audio' || media.type === 'image') && !!media.url && !media.externalId)
}

function line(item: Item) {
  const text = item.text?.trim()
  return text ? `${item.author.name}: ${text}` : item.author.name
}

export function RoomAir({ item, next, onEnded, view, onView }: {
  item?: Item
  next: Item[]
  onEnded: () => void
  view: RoomView
  onView: (view: RoomView) => void
}) {
  const clip = item ? direct(item) : undefined
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [blocked, setBlocked] = useState(false)
  const ended = useRef(onEnded)
  ended.current = onEnded

  useEffect(() => {
    if (!item) return
    setBlocked(false)
    const el = clip?.type === 'audio' ? audioRef.current : clip?.type === 'video' ? videoRef.current : null
    if (el) {
      void el.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') setBlocked(true)
      })
      return
    }
    const timer = window.setTimeout(() => ended.current(), clip ? 4000 : 2500)
    return () => window.clearTimeout(timer)
  }, [item?.id, clip?.url, clip?.type])

  return (
    <div className="room-air" aria-label="Stage">
      {clip?.type === 'audio' && <audio ref={audioRef} src={clip.url} onEnded={() => ended.current()} onError={() => ended.current()} />}
      {clip?.type === 'video' && <video ref={videoRef} src={clip.url} playsInline onEnded={() => ended.current()} onError={() => ended.current()} />}
      {clip?.type === 'image' && <img className="room-air-still" src={clip.url} alt="" />}
      {!item && <p className="room-air-empty">Stage is clear</p>}
      {blocked && (
        <button type="button" className="room-air-play" onClick={() => void (videoRef.current ?? audioRef.current)?.play().then(() => setBlocked(false))}>Play</button>
      )}
      {(item || next.length > 0) && (
        <div className="room-air-note">
          {item && <p>{line(item)}</p>}
          {next.map((queued) => <p key={queued.id}>Next · {line(queued)}</p>)}
        </div>
      )}
      <ViewSwitch value={view} onChange={onView} />
    </div>
  )
}
