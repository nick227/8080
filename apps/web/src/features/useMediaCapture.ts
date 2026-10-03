import { useCallback, useEffect, useRef } from 'react'
import { publishSpectrum, useCapture } from '../state/capture'
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
      await new Promise(r => setTimeout(r, 400)) // allow hardware to release

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
        analyser.fftSize = 128
        const source = audioCtx.createMediaStreamSource(stream)
        source.connect(analyser)

        const data = new Uint8Array(analyser.frequencyBinCount)
        const updateLevel = () => {
          if (recorderRef.current?.state === 'recording') {
            analyser.getByteFrequencyData(data)
            publishSpectrum(data)
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
        // Firefox clears recorder.mimeType by onstop; the chunks keep the real type
        // (a wrong label, e.g. Ogg bytes sent as audio/mp4, is refused by the server).
        const mime = chunksRef.current[0]?.type || recorder.mimeType || (kind === 'video' ? 'video/mp4' : 'audio/mp4')
        const blob = new Blob(chunksRef.current, { type: mime })
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
              
              // Sub-sample to avoid reading millions of floats
              const stride = Math.max(1, Math.floor(step / 100))
              
              for (let i = 0; i < points; i++) {
                let sum = 0
                let count = 0
                for (let j = 0; j < step; j += stride) {
                  let val = channelData[i * step + j]
                  if (val < 0) val = -val // inline Math.abs for speed
                  sum += val
                  count++
                }
                waveform.push(sum / Math.max(1, count))
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
