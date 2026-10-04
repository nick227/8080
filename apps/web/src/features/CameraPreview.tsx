import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getLiveStream, subscribeLive } from './previewStream'

const facingUser = (stream: MediaStream) =>
  stream.getVideoTracks()[0]?.getSettings().facingMode === 'user'

// Shows the recorder's own stream while a take is live. It never opens the camera
// itself: the camera is held only while recording, so its light goes off with the
// take (permission stays granted, so the next Record reconnects without a prompt).
export function CameraPreview({ recording }: { recording: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const live = useSyncExternalStore(subscribeLive, getLiveStream)
  const [mirror, setMirror] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !live) return
    video.srcObject = live
    video.muted = true
    setMirror(facingUser(live))
    void video.play().catch(() => {})
    return () => { video.srcObject = null }
  }, [live])

  return (
    <div className="cam-preview" data-recording={recording || undefined} data-mirror={mirror || undefined}>
      <video ref={videoRef} muted playsInline autoPlay />
    </div>
  )
}
