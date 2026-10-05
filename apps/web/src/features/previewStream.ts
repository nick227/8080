import type { Compositor } from './virtualCamera'

// The recorder's live stream (shown by CameraPreview) and the idle microphone
// monitor. CameraPreview opens its own framing stream only while it's mounted and
// not recording; nothing holds the camera after Stop, Save or closing.

/** Camera constraints shared by the framing preview and the recorder. */
export function cameraConstraints(deviceId: string): MediaTrackConstraints {
  // 1080p when the camera has it (720p and lower still work: these are ideals).
  const video: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 },
  }
  if (deviceId) video.deviceId = { exact: deviceId }
  else video.facingMode = localStorage.getItem('camera_facing') || 'user'
  return video
}

// Opens the camera with the tuned constraints. If the device refuses them (Firefox on
// Windows rejects some webcams' resolution/frame-rate combinations with AbortError
// "Starting videoinput failed"), steps down one hint at a time instead of dropping
// straight to the browser default (Firefox: 640×480): no frame-rate cap, then 720p,
// then the device alone.
const CAMERA_STEPS: { name: string; hints: MediaTrackConstraints }[] = [
  { name: '1080p, no frame-rate cap', hints: { width: { ideal: 1920 }, height: { ideal: 1080 } } },
  { name: '720p', hints: { width: { ideal: 1280 }, height: { ideal: 720 } } },
  { name: 'plain', hints: {} },
]

const refused = (cause: unknown) => {
  const name = cause instanceof DOMException ? cause.name : ''
  return name === 'AbortError' || name === 'NotReadableError' || name === 'OverconstrainedError'
}

export async function openCamera(deviceId: string, audio: MediaStreamConstraints['audio'] = false): Promise<MediaStream> {
  let last: unknown
  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video: cameraConstraints(deviceId) })
  } catch (cause) {
    if (!refused(cause)) throw cause
    last = cause
  }
  const device: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: localStorage.getItem('camera_facing') || 'user' }
  for (const step of CAMERA_STEPS) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: { ...step.hints, ...device } })
      const settings = stream.getVideoTracks()[0]?.getSettings()
      console.warn(`Camera refused tuned constraints; opened with ${step.name} (${settings?.width}×${settings?.height})`, last)
      return stream
    } catch (cause) {
      if (!refused(cause)) throw cause
      last = cause
    }
  }
  throw last
}

let paused = false

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

// The recorder's compositor while a virtual-background take is live (its preview
// canvas replaces the raw stream in CameraPreview).
let liveCompositor: Compositor | null = null

export function getLiveCompositor() {
  return liveCompositor
}

export function publishLiveCompositor(compositor: Compositor | null) {
  if (liveCompositor === compositor) return
  liveCompositor = compositor
  listeners.forEach((listener) => listener())
}

export function pausePreview(cameraDeviceId?: string): MediaStream | null {
  paused = true
  // Transfer the working camera without stopping/reopening the hardware.
  const track = framingCurrent?.getVideoTracks()[0]
  const reuse = cameraDeviceId !== undefined && track?.readyState === 'live'
    && (!cameraDeviceId || track.getSettings().deviceId === cameraDeviceId)
  const camera = reuse ? framingCurrent : null
  if (reuse) framingCurrent = null
  else releaseFraming()
  releaseAudioMonitor()
  return camera
}

export function resumePreview() {
  paused = false
}

let framingCurrent: MediaStream | null = null

export function releaseFraming(owner?: MediaStream) {
  if (owner && owner !== framingCurrent) return
  const held = framingCurrent
  framingCurrent = null
  held?.getTracks().forEach((track) => track.stop())
}

// Keeps the framing stream only while nothing is about to record. A late
// getUserMedia that arrives after Record is stopped instead of kept.
export function claimFraming(stream: MediaStream) {
  if (paused) {
    stream.getTracks().forEach((track) => track.stop())
    return false
  }
  releaseFraming()
  framingCurrent = stream
  return true
}

// Live microphone for the desk wave. pausePreview drops it before the recorder opens its own.
let audioGen = 0
let audioCurrent: MediaStream | null = null

export function releaseAudioMonitor() {
  audioGen += 1
  const held = audioCurrent
  audioCurrent = null
  held?.getTracks().forEach((track) => track.stop())
}

export function openAudioMonitor(deviceId: string): Promise<MediaStream | null> {
  if (paused) return Promise.resolve(null)
  const gen = audioGen
  const audio: boolean | MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : true
  return navigator.mediaDevices
    .getUserMedia({ audio, video: false })
    .then((stream) => {
      if (paused || gen !== audioGen) {
        stream.getTracks().forEach((track) => track.stop())
        return null
      }
      audioCurrent = stream
      return stream
    })
    .catch(() => null)
}
