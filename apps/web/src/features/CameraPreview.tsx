import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useCapture } from '../state/capture'
import { cameraConstraints, getLiveStream, subscribeLive } from './previewStream'

const facingUser = (stream: MediaStream) =>
  stream.getVideoTracks()[0]?.getSettings().facingMode === 'user'

const stopAll = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop())

// Camera view on the record surface. While recording it shows the recorder's own
// stream. Otherwise it opens a framing stream that it alone owns: stopped when it
// unmounts (Stop → playback, Save, closing, leaving camera mode) and when recording
// starts, so the recorder can take the camera. Permission persists across reopens.
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
    let own: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({ audio: false, video: cameraConstraints(deviceId) })
      .then((stream) => {
        if (gone) return stopAll(stream)
        own = stream
        attach(stream)
      })
      .catch(() => undefined)

    return () => {
      gone = true
      if (own) stopAll(own)
      video.srcObject = null
    }
  }, [deviceId, live, hold])

  return (
    <div className="cam-preview" data-recording={recording || undefined} data-mirror={mirror || undefined}>
      <video ref={videoRef} muted playsInline autoPlay />
    </div>
  )
}
