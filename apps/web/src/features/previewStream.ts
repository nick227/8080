// Idle camera preview and the recorder must not both hold the camera.
// Recording pauses this stream, waits for it to drop, then opens its own.

let generation = 0
let paused = false
let current: MediaStream | null = null
let pending: Promise<void> = Promise.resolve()

let live: MediaStream | null = null
const listeners = new Set<() => void>()

export function subscribeLive(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getLiveStream() {
  return live
}

export function publishLiveStream(stream: MediaStream | null) {
  if (live === stream) return
  live = stream
  listeners.forEach((listener) => listener())
}

export function pausePreview(): Promise<void> {
  paused = true
  return releasePreviewStream()
}

export function resumePreview() {
  paused = false
}

export function releasePreviewStream(): Promise<void> {
  generation += 1
  const held = current
  current = null
  held?.getTracks().forEach((track) => track.stop())
  return pending
}

export function openPreviewStream(deviceId: string): Promise<MediaStream | null> {
  if (paused) return Promise.resolve(null)
  const gen = generation
  const video: MediaTrackConstraints = {
    width: { ideal: 640 },
    height: { ideal: 480 },
  }
  if (deviceId) video.deviceId = { exact: deviceId }
  else video.facingMode = localStorage.getItem('camera_facing') || 'user'

  const job = navigator.mediaDevices
    .getUserMedia({ audio: false, video })
    .then((stream) => {
      if (paused || gen !== generation) {
        stream.getTracks().forEach((track) => track.stop())
        return null
      }
      current = stream
      return stream
    })
    .catch(() => null)

  pending = job.then(() => undefined)
  return job
}
