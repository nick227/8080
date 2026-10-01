import { useEffect, useRef, useState } from 'react'
import { youTubeThumbnailUrl } from '@project/shared'
import { createYouTubePlayer, type YouTubeController, type YouTubeErrorKind } from '../media/youtube/controller'
import { formatMoment } from '../utils/anchor'

// Composer preview for a pasted YouTube link: loads the player (no autoplay) to learn
// duration / title / whether it can play inline, and reports that upward so Send can
// register the video correctly. Never downloads anything.
export type YouTubePreviewResult =
  | { status: 'loading' }
  | { status: 'ready'; durationMs: number | undefined; title: string | null }
  | { status: 'not-embeddable' } // still postable as a link card (no anchors)
  | { status: 'unavailable' } // missing/private/invalid: not postable
  | { status: 'offline' } // player couldn't load here: postable, no duration

export function YouTubePreview({ videoId, onResolved }: { videoId: string; onResolved: (r: YouTubePreviewResult) => void }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<YouTubePreviewResult>({ status: 'loading' })
  const report = useRef(onResolved)
  report.current = onResolved

  useEffect(() => {
    let ctrl: YouTubeController | null = null
    let cancelled = false
    const set = (r: YouTubePreviewResult) => {
      if (cancelled) return
      setState(r)
      report.current(r)
    }
    set({ status: 'loading' })
    const host = document.createElement('div')
    frameRef.current?.appendChild(host)
    createYouTubePlayer(host, videoId)
      .then((c) => {
        if (cancelled) return c.destroy()
        ctrl = c
        set({ status: 'ready', durationMs: c.getDurationMs() ?? undefined, title: c.getTitle() })
      })
      .catch((err: { kind?: YouTubeErrorKind }) => {
        const kind = err?.kind
        set(kind === 'not-embeddable' ? { status: 'not-embeddable' } : kind ? { status: 'unavailable' } : { status: 'offline' })
      })
    return () => {
      cancelled = true
      ctrl?.destroy()
      host.remove()
    }
  }, [videoId])

  return (
    <div className="yt-preview" data-status={state.status}>
      <div className="yt-frame">
        <div className="yt-player" ref={frameRef} />
        {state.status !== 'ready' && <img className="yt-preview-thumb" src={youTubeThumbnailUrl(videoId)} alt="" />}
      </div>
      <div className="yt-meta">
        <span className="yt-source">
          YOUTUBE
          {state.status === 'ready' && state.title ? ` · ${state.title}` : ''}
          {state.status === 'ready' && state.durationMs ? ` · ${formatMoment(state.durationMs)}` : ''}
        </span>
        <span className="yt-status">
          {state.status === 'loading' ? 'CHECKING…' : state.status === 'not-embeddable' ? 'PLAYS ON YOUTUBE ONLY — NO REPLY-AT-MOMENT' : state.status === 'unavailable' ? 'VIDEO UNAVAILABLE' : state.status === 'offline' ? 'PREVIEW UNAVAILABLE' : ''}
        </span>
      </div>
    </div>
  )
}
