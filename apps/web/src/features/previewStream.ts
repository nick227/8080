// The recorder's live stream (shown by CameraPreview) and the idle microphone
// monitor. The camera is opened only by the recorder; nothing holds it between takes.

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

export function pausePreview(): Promise<void> {
  paused = true
  return Promise.resolve()
}

export function resumePreview() {
  paused = false
}

// Live microphone for the desk wave. Recording calls pausePreview first so this
// drops the mic before the recorder opens its own stream.
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
