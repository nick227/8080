import { create } from 'zustand'
import { useBackground } from '../../../state/background'
import { openCamera } from '../../previewStream'
import { currentMaskSource, effectiveMode, facingUser, loadMaskSource, startCompositor, type Compositor } from '../../virtualCamera'

// This person's live broadcast in the room: camera (through the existing virtual
// background compositor when a background is chosen) or a shared screen. One
// session for the whole room page — the self tile only displays it, so Grid,
// Full and other desks never restart the camera or open a second connection.
// Publishing to LiveKit is LiveRoom's job; this module owns capture only.
// Async recordings are separate: they go through Chat (useRecordSession).

export type LiveKind = 'off' | 'camera' | 'screen'
type Look = 'camera' | 'blur' | 'photo'

type State = {
  kind: LiveKind
  starting: boolean
  // The track to publish, and the element the self tile shows.
  track: MediaStreamTrack | null
  preview: HTMLElement | null
  error: string | null
  startCamera: () => Promise<void>
  startScreen: () => Promise<void>
  stop: () => void
}

// Demo safety limit carried over from the self tile: live ends after 5 minutes.
const LIVE_LIMIT_MS = 5 * 60 * 1000

let stream: MediaStream | null = null
let compositor: Compositor | null = null
let limit: number | undefined
let generation = 0

function videoFor(media: MediaStream, fit: 'cover' | 'contain') {
  const video = document.createElement('video')
  video.autoplay = true
  video.playsInline = true
  video.muted = true
  video.srcObject = media
  Object.assign(video.style, { width: '100%', height: '100%', objectFit: fit })
  void video.play().catch(() => {})
  return video
}

function release() {
  window.clearTimeout(limit)
  compositor?.stop()
  compositor = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
}

function cameraLook(): Look {
  const mode = useBackground.getState().mode
  return mode === 'original' ? 'camera' : mode
}

function failure(error: unknown) {
  const name = (error as { name?: string })?.name
  if (name === 'NotAllowedError') return 'Camera or screen access was blocked'
  if (name === 'NotFoundError') return 'No camera found'
  if (name === 'NotReadableError') return 'The camera is in use by another app'
  return 'Couldn’t start live video'
}

export const useLocalLive = create<State>((set, get) => {
  const startLimit = () => {
    window.clearTimeout(limit)
    limit = window.setTimeout(() => {
      get().stop()
      window.alert('Demo Safety Protection: Your 5-minute streaming limit has been reached to conserve minutes. Premium memberships coming soon!')
    }, LIVE_LIMIT_MS)
  }

  // Starting anything replaces what's live; a stale async start never wins.
  async function begin(kind: Exclude<LiveKind, 'off'>, capture: () => Promise<{ track: MediaStreamTrack; preview: HTMLElement }>) {
    const mine = ++generation
    release()
    set({ starting: true, error: null })
    try {
      const { track, preview } = await capture()
      if (mine !== generation) return
      // The browser's own "Stop sharing" (or a camera unplugged) ends live too.
      track.addEventListener('ended', () => { if (get().track === track) get().stop() })
      set({ kind, track, preview, starting: false })
      startLimit()
    } catch (error) {
      if (mine !== generation) return
      release()
      set({ kind: 'off', track: null, preview: null, starting: false, error: failure(error) })
    }
  }

  return {
    kind: 'off',
    starting: false,
    track: null,
    preview: null,
    error: null,

    startCamera: () => begin('camera', async () => {
      stream = await openCamera('')
      const look = cameraLook()
      const effect = look === 'camera' || effectiveMode() === 'original' ? 'original' : look
      if (effect === 'original') return { track: stream.getVideoTracks()[0]!, preview: videoFor(stream, 'cover') }
      // The frozen virtual-background pipeline, reused as is (doc/07): its processed
      // track is what goes live; its mirrored preview canvas is what the tile shows.
      const source = currentMaskSource() ?? (await loadMaskSource())
      const photoUrl = effect === 'photo' ? useBackground.getState().photo?.url ?? null : null
      compositor = startCompositor(source, stream, { mode: effect, photoUrl, mirror: facingUser(stream), fixedSize: true }, (msg) => console.warn('Compositor unavailable:', msg))
      Object.assign(compositor.preview.style, { width: '100%', height: '100%', objectFit: 'cover' })
      return { track: compositor.stream.getVideoTracks()[0]!, preview: compositor.preview }
    }),

    startScreen: () => begin('screen', async () => {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      return { track: stream.getVideoTracks()[0]!, preview: videoFor(stream, 'contain') }
    }),

    stop() {
      generation++
      release()
      set({ kind: 'off', track: null, preview: null, starting: false })
    },
  }
})

// A background change while the camera is live restarts it with the new look.
useBackground.subscribe((state, prev) => {
  if (state.mode === prev.mode && state.photo?.url === prev.photo?.url) return
  if (useLocalLive.getState().kind === 'camera') void useLocalLive.getState().startCamera()
})
