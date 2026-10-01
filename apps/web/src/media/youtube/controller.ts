import type { PlayableMediaController, PlayOutcome } from '../controller'
import { loadYouTubeApi, type YTPlayer, type YTPlayerState } from './api'

// YouTube's IFrame player behind our PlayableMediaController. Maps its states and
// error codes onto the same outcomes our <video>/<audio> use: playing / blocked
// (needs a tap) / unplayable (skip) / ended.

export type YouTubeErrorKind = 'invalid' | 'unavailable' | 'not-embeddable' | 'playback'
export const youTubeErrorKind = (code: number): YouTubeErrorKind =>
  code === 101 || code === 150 ? 'not-embeddable' : code === 100 ? 'unavailable' : code === 2 ? 'invalid' : 'playback'

const BLOCKED_AFTER_MS = 2500

export class YouTubeController implements PlayableMediaController {
  readonly kind = 'youtube' as const
  private ended = new Set<() => void>()
  private stateWaiters = new Set<(s: YTPlayerState) => void>()
  private errorWaiters = new Set<() => void>()
  state: YTPlayerState = -1
  error: YouTubeErrorKind | null = null

  constructor(private player: YTPlayer) {}

  /** Called by the player's event plumbing (see createYouTubePlayer). */
  handleState(s: YTPlayerState) {
    this.state = s
    for (const w of [...this.stateWaiters]) w(s)
    if (s === 0) for (const cb of [...this.ended]) cb()
  }
  handleError(code: number) {
    this.error = youTubeErrorKind(code)
    for (const w of [...this.errorWaiters]) w()
  }

  play(): Promise<PlayOutcome> {
    if (this.error) return Promise.resolve('unplayable')
    return new Promise<PlayOutcome>((resolve) => {
      let timer: ReturnType<typeof setTimeout>
      const done = (o: PlayOutcome) => {
        clearTimeout(timer)
        this.stateWaiters.delete(onState)
        this.errorWaiters.delete(onError)
        resolve(o)
      }
      const onState = (s: YTPlayerState) => { if (s === 1) done('playing') }
      const onError = () => done('unplayable')
      this.stateWaiters.add(onState)
      this.errorWaiters.add(onError)
      // Buffering means it is starting; only a player that stays unstarted/cued/paused is blocked.
      const check = () => (this.state === 3 ? (timer = setTimeout(check, BLOCKED_AFTER_MS)) : done('blocked'))
      timer = setTimeout(check, BLOCKED_AFTER_MS)
      this.player.playVideo()
      if (this.player.getPlayerState() === 1) done('playing')
    })
  }
  pause() { this.player.pauseVideo() }
  seek(ms: number) { this.player.seekTo(Math.max(0, ms) / 1000, true) }
  getCurrentTimeMs() { return Math.round((this.player.getCurrentTime() || 0) * 1000) }
  getDurationMs() {
    const d = this.player.getDuration()
    return d > 0 ? Math.round(d * 1000) : null
  }
  getTitle() { return this.player.getVideoData?.().title || null }
  onEnded(cb: () => void) {
    this.ended.add(cb)
    return () => { this.ended.delete(cb) }
  }
  destroy() {
    this.ended.clear()
    this.stateWaiters.clear()
    this.errorWaiters.clear()
    try { this.player.destroy() } catch { /* already gone */ }
  }
}

/** Mounts a player into `host` (replacing it with YouTube's iframe) and resolves when ready. */
export async function createYouTubePlayer(host: HTMLElement, videoId: string, opts: { onError?: (kind: YouTubeErrorKind) => void; onState?: (s: YTPlayerState) => void } = {}) {
  const YT = await loadYouTubeApi()
  return new Promise<YouTubeController>((resolve, reject) => {
    let controller: YouTubeController | null = null
    let settled = false
    const player = new YT.Player(host, {
      videoId,
      host: 'https://www.youtube-nocookie.com',
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, enablejsapi: 1, origin: window.location.origin },
      events: {
        onReady: (e) => {
          controller = new YouTubeController(e.target)
          settled = true
          resolve(controller)
        },
        onStateChange: (e) => {
          controller?.handleState(e.data)
          opts.onState?.(e.data)
        },
        onError: (e) => {
          const kind = youTubeErrorKind(e.data)
          controller?.handleError(e.data)
          opts.onError?.(kind)
          if (!settled) {
            settled = true
            reject(Object.assign(new Error(kind), { kind }))
          }
        },
      },
    })
    void player
  })
}
