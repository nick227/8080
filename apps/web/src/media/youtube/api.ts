// Loads the YouTube IFrame Player API once. YouTube-specific; nothing outside
// media/youtube/* and YouTubeMedia/YouTubePreview should touch window.YT.

export type YTPlayerState = -1 | 0 | 1 | 2 | 3 | 5 // unstarted, ended, playing, paused, buffering, cued
export interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): YTPlayerState
  getVideoData?(): { title?: string; video_id?: string }
  destroy(): void
}
export interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string
      host?: string
      width?: string | number
      height?: string | number
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (e: { target: YTPlayer }) => void
        onStateChange?: (e: { data: YTPlayerState; target: YTPlayer }) => void
        onError?: (e: { data: number; target: YTPlayer }) => void
      }
    },
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const API_URL = 'https://www.youtube.com/iframe_api'
let loading: Promise<YTNamespace> | null = null

export function loadYouTubeApi(timeoutMs = 10000): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  loading ??= new Promise<YTNamespace>((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('YouTube player did not load')), timeoutMs)
    const fail = (err: Error) => {
      clearTimeout(timer)
      loading = null
      reject(err)
    }
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      clearTimeout(timer)
      if (window.YT?.Player) resolve(window.YT)
      else fail(new Error('YouTube player unavailable'))
    }
    const script = document.createElement('script')
    script.src = API_URL
    script.async = true
    script.onerror = () => fail(new Error('YouTube player unavailable'))
    document.head.appendChild(script)
  })
  return loading
}
