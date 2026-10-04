import { useEffect, useRef, useState } from 'react'
import { dwellMs } from '../../components/Item'
import type { Item, Media } from '../../api/types'

function direct(item: Item): Media | undefined {
  return item.media?.find((media) => (media.type === 'video' || media.type === 'audio' || media.type === 'image') && !!media.url && !media.externalId)
}

function line(item: Item) {
  const text = item.text?.trim()
  return text ? `${item.author.name}: ${text}` : item.author.name
}

export function RoomAir({ item, next, onEnded, paused }: { item?: Item; next: Item[]; onEnded: () => void; paused?: boolean }) {
  const clip = item ? direct(item) : undefined
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [blocked, setBlocked] = useState(false)
  const ended = useRef(onEnded)
  ended.current = onEnded

  useEffect(() => {
    if (!item || paused) return
    setBlocked(false)
    const el = clip?.type === 'audio' ? audioRef.current : clip?.type === 'video' ? videoRef.current : null
    if (el) {
      void el.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') setBlocked(true)
      })
      return
    }
    const timer = window.setTimeout(() => ended.current(), dwellMs(item))
    return () => window.clearTimeout(timer)
  }, [item, paused, clip?.url, clip?.type])

  return (
    <div className="room-air" aria-label="Stage">
      {clip?.type === 'audio' && <audio ref={audioRef} src={clip.url} onEnded={() => ended.current()} onError={() => ended.current()} />}
      {clip?.type === 'video' && <video ref={videoRef} src={clip.url} playsInline onEnded={() => ended.current()} onError={() => ended.current()} />}
      {clip?.type === 'image' && <img className="room-air-still" src={clip.url} alt="" />}
      {item?.text?.trim() && !clip && <p className="room-air-copy">{item.text.trim()}</p>}
      {blocked && (
        <button type="button" className="room-air-play" onClick={() => void (videoRef.current ?? audioRef.current)?.play().then(() => setBlocked(false))}>Play</button>
      )}
      {(item || next.length > 0) && (
        <div className="room-air-note">
          {item && <p>{item.text?.trim() && !clip ? item.author.name : line(item)}</p>}
          {next.map((queued) => <p key={queued.id}>Next · {line(queued)}</p>)}
        </div>
      )}
    </div>
  )
}
