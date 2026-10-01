import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useCapture } from '../state/capture'
import { getLiveStream, openPreviewStream, releasePreviewStream, subscribeLive } from './previewStream'

const facingUser = (stream: MediaStream) =>
  stream.getVideoTracks()[0]?.getSettings().facingMode === 'user'

export function CameraPreview({ deviceId, recording }: { deviceId: string; recording: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const live = useSyncExternalStore(subscribeLive, getLiveStream)
  const phase = useCapture((s) => s.phase)
  const hold = phase === 'arming' || phase === 'recording' || phase === 'stopping'
  const [mirror, setMirror] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const attach = (stream: MediaStream) => {
      video.srcObject = stream
      video.muted = true
      setMirror(facingUser(stream))
      void video.play().catch(() => {})
    }

    if (live) {
      attach(live)
      return () => { video.srcObject = null }
    }
    if (hold) return

    let gone = false
    void openPreviewStream(deviceId).then((stream) => {
      if (!stream || gone) return
      attach(stream)
    })
    return () => {
      gone = true
      void releasePreviewStream()
      video.srcObject = null
    }
  }, [deviceId, live, hold])

  return (
    <div className="cam-preview" data-recording={recording || undefined} data-mirror={mirror || undefined}>
      <video ref={videoRef} muted playsInline autoPlay />
    </div>
  )
}
