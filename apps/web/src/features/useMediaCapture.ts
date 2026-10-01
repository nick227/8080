import { useCallback, useEffect, useRef } from 'react'
import { useCapture } from '../state/capture'
import { pausePreview, publishLiveStream, resumePreview } from './previewStream'

const getConstraints = (kind: 'audio' | 'video', deviceId: string): MediaStreamConstraints => {
  if (kind === 'audio') return { audio: deviceId ? { deviceId: { exact: deviceId } } : true }

  const video: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  }
  if (deviceId) video.deviceId = { exact: deviceId }
  else video.facingMode = localStorage.getItem('camera_facing') || 'user'
  return { audio: true, video }
}

export function useMediaCapture() {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const cancelledRef = useRef(false)
  const previewRef = useRef<string | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const animRef = useRef<number>(0)

  const disposeStream = useCallback(() => {
    const stream = streamRef.current
    streamRef.current = null
    publishLiveStream(null)
    stream?.getTracks().forEach(track => track.stop())
    resumePreview()
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    cancelAnimationFrame(animRef.current)
  }, [])

  // Resolves true once recording has started; false if the device/permission failed
  // (capture phase is then 'captureFailed' with `error` set).
  const start = useCallback(async (kind: 'audio' | 'video', deviceId = ''): Promise<boolean> => {
    const capture = useCapture.getState()
    try {
      capture.arm(kind)
      await pausePreview()

      let timeoutId: ReturnType<typeof setTimeout>
      const streamPromise = navigator.mediaDevices.getUserMedia(getConstraints(kind, deviceId))
      const timeoutPromise = new Promise<MediaStream | null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), 15000)
      })

      const stream = await Promise.race([streamPromise, timeoutPromise])
      clearTimeout(timeoutId!)

      if (!stream) {
        streamPromise.then(s => s.getTracks().forEach(t => t.stop())).catch(() => {})
        resumePreview()
        const device = kind === 'video' ? 'CAMERA' : 'MICROPHONE'
        useCapture.setState({ phase: 'idle', error: `${device} PERMISSION TIMED OUT` })
        return false
      }

      const recorder = new MediaRecorder(stream)
      
      if (kind === 'audio') {
        const audioCtx = new AudioContext()
        audioCtxRef.current = audioCtx
        const analyser = audioCtx.createAnalyser()
        const source = audioCtx.createMediaStreamSource(stream)
        source.connect(analyser)
        
        const data = new Uint8Array(analyser.frequencyBinCount)
        const updateLevel = () => {
          if (recorderRef.current?.state === 'recording') {
            analyser.getByteFrequencyData(data)
            useCapture.setState({ level: Math.max(...data) / 255 })
          }
          animRef.current = requestAnimationFrame(updateLevel)
        }
        updateLevel()
      }
      
      chunksRef.current = []
      cancelledRef.current = false
      streamRef.current = stream
      if (kind === 'video') publishLiveStream(stream)
      recorderRef.current = recorder
      startedAtRef.current = performance.now()
      
      recorder.ondataavailable = event => event.data.size > 0 && chunksRef.current.push(event.data)
      recorder.onerror = () => {
        resumePreview()
        capture.failCapture('Recording failed')
      }
      recorder.onstop = () => {
        if (cancelledRef.current) {
          chunksRef.current = []
          disposeStream()
          return
        }
        const durationMs = Math.max(0, performance.now() - startedAtRef.current)
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || `${kind}/webm` })
        const previewUrl = URL.createObjectURL(blob)
        previewRef.current = previewUrl
        
        if (kind === 'audio') {
          blob.arrayBuffer().then(async arrayBuffer => {
            // One short-lived context per decode, always closed — browsers cap live AudioContexts.
            const ctx = new AudioContext()
            try {
              const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
              const channelData = audioBuffer.getChannelData(0)
              
              const points = 50
              const step = Math.max(1, Math.floor(channelData.length / points))
              const waveform: number[] = []
              
              for (let i = 0; i < points; i++) {
                let sum = 0
                for (let j = 0; j < step; j++) {
                  sum += Math.abs(channelData[i * step + j])
                }
                waveform.push(sum / step)
              }
              
              const max = Math.max(...waveform, 0.001)
              capture.review(blob, previewUrl, durationMs, waveform.map(n => n / max))
            } catch (e) {
              console.error('Waveform extraction failed', e)
              capture.review(blob, previewUrl, durationMs)
            } finally {
              ctx.close().catch(() => {})
            }
          })
        } else {
          capture.review(blob, previewUrl, durationMs)
        }
        disposeStream()
      }
      
      recorder.start(250)
      capture.begin()
      return true
    } catch (cause) {
      disposeStream()
      const device = kind === 'video' ? 'Camera' : 'Microphone'
      const name = cause instanceof DOMException ? cause.name : ''
      const denied = name === 'NotAllowedError' || name === 'SecurityError'
      const msg = denied ? `${device} access was blocked`
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? `No ${device.toLowerCase()} found`
        : name === 'NotReadableError' || name === 'AbortError' ? `${device} is in use by another app`
        : `${device} unavailable`
      if (denied) useCapture.setState({ phase: 'permissionDenied', error: msg })
      else capture.failCapture(msg)
      return false
    }
  }, [disposeStream])

  const stop = useCallback(() => {
    const capture = useCapture.getState()
    capture.stop()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const cancel = useCallback(() => {
    const capture = useCapture.getState()
    cancelledRef.current = true
    recorderRef.current?.state === 'recording' && recorderRef.current.stop()
    disposeStream()
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    capture.cancel()
  }, [disposeStream])

  useEffect(() => () => {
    disposeStream()
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
  }, [disposeStream])

  return { start, stop, cancel }
}
