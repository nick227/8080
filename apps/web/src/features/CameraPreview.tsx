import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useCapture } from '../state/capture'
import { useBackground } from '../state/background'
import { claimFraming, openCamera, getLiveCompositor, getLiveStream, releaseFraming, subscribeLive } from './previewStream'
import { currentMaskSource, ensureMaskSource, facingUser, loadMaskSource, startCompositor, type Compositor } from './virtualCamera'
import { VbgReadout } from './room/VbgReadout'

const stopAll = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop())

// Camera view on the record surface. While recording it shows the recorder's own
// stream (or its virtual-background compositor). Otherwise it opens a framing stream
// that it owns until recording takes it over. Unmounting stops only a stream still
// owned by the preview; it must not stop a stream transferred to the recorder.
// Permission persists across reopens. With Blur/Photo chosen, the framing stream runs
// through a compositor and its preview canvas replaces the raw video.
export function CameraPreview({ deviceId, recording }: { deviceId: string; recording: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const live = useSyncExternalStore(subscribeLive, getLiveStream)
  const liveCompositor = useSyncExternalStore(subscribeLive, getLiveCompositor)
  const phase = useCapture((s) => s.phase)
  const hold = phase === 'arming' || phase === 'recording' || phase === 'stopping'
  const mode = useBackground((s) => (s.status === 'unavailable' ? 'original' : s.mode))
  const photoUrl = useBackground((s) => s.photo?.url ?? null)
  const ready = useBackground((s) => s.status === 'ready')
  const [own, setOwn] = useState<MediaStream | null>(null)
  const [framing, setFraming] = useState<Compositor | null>(null)
  const shown = liveCompositor ?? framing
  const raw = live ?? own

  useEffect(() => { if (mode !== 'original') ensureMaskSource() }, [mode])

  // The framing stream: open while there's no take holding the camera.
  useEffect(() => {
    if (live || liveCompositor || hold) return
    let gone = false
    let stream: MediaStream | null = null
    openCamera(deviceId)
      .then((s) => {
        if (gone || !claimFraming(s)) return stopAll(s)
        stream = s
        setOwn(s)
      })
      .catch((cause: unknown) => { console.warn('Camera preview failed', cause) })
    return () => {
      gone = true
      if (stream) releaseFraming(stream)
      stream = null
      setOwn(null)
    }
  }, [deviceId, live, liveCompositor, hold])

  // Raw camera view (Original, or while the compositor isn't up yet).
  useEffect(() => {
    const video = videoRef.current
    if (!video || !raw) return
    video.srcObject = raw
    video.muted = true
    void video.play().catch(() => {})
    return () => { video.srcObject = null }
  }, [raw])

  // Framing compositor for Blur/Photo, once the segmenter is ready.
  const effect = mode === 'original' ? null : mode
  useEffect(() => {
    if (!own || !effect || !ready) return
    let gone = false
    let compositor: Compositor | null = null
    void loadMaskSource().then((loaded) => {
      const source = currentMaskSource() ?? loaded
      if (gone) return
      const { photo } = useBackground.getState()
      compositor = startCompositor(source, own, { mode: effect, photoUrl: photo?.url ?? null, mirror: facingUser(own) },
        (message) => useBackground.getState().setStatus('unavailable', message))
      setFraming(compositor)
    })
    return () => {
      gone = true
      compositor?.stop()
      setFraming(null)
    }
    // Switching blur ↔ photo is an option change below, not a new compositor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, !!effect, ready])

  useEffect(() => {
    if (framing && effect) framing.setOptions({ mode: effect, photoUrl })
  }, [framing, effect, photoUrl])

  // Show the compositor's preview canvas in place of the raw video.
  useEffect(() => {
    const slot = slotRef.current
    if (!slot || !shown) return
    slot.append(shown.preview)
    return () => { shown.preview.remove() }
  }, [shown])

  const mirror = !shown && !!raw && facingUser(raw)
  return (
    <div className="cam-preview" data-recording={recording || undefined} data-mirror={mirror || undefined} data-composite={shown ? '' : undefined}>
      <video ref={videoRef} muted playsInline autoPlay />
      <div ref={slotRef} className="cam-composite" />
      {shown && <VbgReadout />}
    </div>
  )
}
