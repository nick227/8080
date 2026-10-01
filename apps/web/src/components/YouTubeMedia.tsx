import { useEffect, useRef, useState } from 'react'
import { youTubeThumbnailUrl, youTubeWatchUrl } from '@project/shared'
import { registerController } from '../media/controller'
import { createYouTubePlayer, type YouTubeController, type YouTubeErrorKind } from '../media/youtube/controller'
import { AnchorRail } from './AnchorRail'
import { formatMoment, type Anchor } from '../utils/anchor'

// External YouTube video as a first-class playable item. YouTube owns the picture;
// we own the conversation layer: our own timeline (progress, seek, anchor markers)
// sits beneath the embed. Playback follows the app's UI state exactly like stored
// video: active → play, inactive → pause, ended → onEnded, unplayable → skip.
export function YouTubeMedia({
  videoId, title, embeddable = true, isActive, isUpcoming, onEnded, onRequestPlay,
  anchors, anchorDurationMs, activeAnchorId, onAnchorSelect,
}: {
  videoId: string
  title?: string
  embeddable?: boolean
  isActive?: boolean
  isUpcoming?: boolean
  onEnded?: () => void
  onRequestPlay?: () => void
  anchors?: Anchor[]
  anchorDurationMs?: number
  activeAnchorId?: string
  onAnchorSelect?: (ids: string[], ms: number) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const ctrlRef = useRef<YouTubeController | null>(null)
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  // Facade until needed: no iframe (or YouTube request) for posts nobody is playing.
  const [activated, setActivated] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<YouTubeErrorKind | null>(embeddable ? null : 'not-embeddable')
  const [blocked, setBlocked] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [durationMs, setDurationMs] = useState<number | null>(anchorDurationMs ?? null)
  // Sticky: once the player exists it stays (pausing for REPLY HERE or going idle must
  // not destroy it and lose the position).
  useEffect(() => { if (isActive || isUpcoming) setActivated(true) }, [isActive, isUpcoming])
  const wantPlayer = !error && (activated || !!isActive || !!isUpcoming)

  // Mount the player into an imperatively created node (YouTube replaces it with an
  // iframe — React must not own that node).
  useEffect(() => {
    if (!wantPlayer || ctrlRef.current || !frameRef.current) return
    let cancelled = false
    let unregister = () => {}
    let unEnded = () => {}
    const host = document.createElement('div')
    frameRef.current.appendChild(host)
    createYouTubePlayer(host, videoId, { onError: (kind) => setError(kind) })
      .then((ctrl) => {
        if (cancelled) return ctrl.destroy()
        ctrlRef.current = ctrl
        unregister = rootRef.current ? registerController(rootRef.current, ctrl) : unregister
        unEnded = ctrl.onEnded(() => onEndedRef.current?.())
        setDurationMs(ctrl.getDurationMs() ?? anchorDurationMs ?? null)
        setReady(true)
      })
      .catch((err: { kind?: YouTubeErrorKind }) => {
        if (cancelled) return
        setError(err?.kind ?? 'playback')
      })
    return () => {
      cancelled = true
      unEnded()
      unregister()
      ctrlRef.current?.destroy()
      ctrlRef.current = null
      setReady(false)
      host.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantPlayer, videoId])

  // Follow the app's playback state.
  useEffect(() => {
    const ctrl = ctrlRef.current
    if (!ready || !ctrl) return
    if (isActive) {
      ctrl.play().then((outcome) => {
        if (!isActiveRef.current) return
        setBlocked(outcome === 'blocked')
        if (outcome === 'unplayable') onEndedRef.current?.() // never stall continuous playback
      })
    } else {
      ctrl.pause()
      setBlocked(false)
    }
  }, [isActive, ready])

  // An error while this item is the playhead means it can't play: skip it.
  useEffect(() => {
    if (error && isActiveRef.current) onEndedRef.current?.()
  }, [error])

  // Our timeline follows the player's clock.
  useEffect(() => {
    if (!ready) return
    const t = setInterval(() => {
      const ctrl = ctrlRef.current
      if (!ctrl) return
      setPositionMs(ctrl.getCurrentTimeMs())
      const d = ctrl.getDurationMs()
      if (d) setDurationMs(d)
      if (ctrl.state === 1) setBlocked(false)
    }, 250)
    return () => clearInterval(t)
  }, [ready])

  const start = () => {
    if (isActive && ctrlRef.current) return void ctrlRef.current.play().then((o) => setBlocked(o === 'blocked'))
    if (onRequestPlay) return onRequestPlay() // through the app's playback (follow, options, dwell rules)
    setActivated(true)
  }
  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const ctrl = ctrlRef.current
    if (!ctrl || !durationMs) return start()
    const r = e.currentTarget.getBoundingClientRect()
    ctrl.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * durationMs)
  }

  const progress = durationMs ? Math.min(1, positionMs / durationMs) : 0
  const thumb = youTubeThumbnailUrl(videoId)

  return (
    <div className="yt" ref={rootRef} data-youtube={videoId}>
      <div className="yt-frame">
        {error ? (
          <a className="yt-card" href={youTubeWatchUrl(videoId)} target="_blank" rel="noopener noreferrer">
            <img src={thumb} alt="" loading="lazy" />
            <span className="yt-card-label">
              {title && <span className="yt-card-title">{title}</span>}
              <span>{error === 'not-embeddable' ? 'PLAYBACK OFF-SITE' : 'UNAVAILABLE HERE'} · OPEN ON YOUTUBE ↗</span>
            </span>
          </a>
        ) : (
          <>
            <div className="yt-player" ref={frameRef} />
            {!ready && (
              <button type="button" className="yt-facade" onClick={start} aria-label={`Play ${title ?? 'YouTube video'}`}>
                <img src={thumb} alt="" loading="lazy" />
                <span className="yt-facade-play" aria-hidden>{wantPlayer ? '···' : '▶'}</span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Our conversation timeline: YouTube owns playback UI, we own this layer. */}
      <div className="yt-timeline">
        {!error && (
          <div className="yt-track" role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={durationMs ?? 0} aria-valuenow={positionMs} tabIndex={-1} onClick={seekTo}>
            <div className="yt-track-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        <div className="yt-meta">
          <span className="yt-source">YOUTUBE{title ? ` · ${title}` : ''}</span>
          {blocked ? (
            <button type="button" className="yt-tap" onClick={start}>TAP TO CONTINUE</button>
          ) : (
            !error && durationMs != null && <span className="yt-time">{formatMoment(positionMs)} / {formatMoment(durationMs)}</span>
          )}
        </div>

      </div>
    </div>
  )
}
