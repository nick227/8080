import { useEffect, useState } from 'react'
import { readSpectrum } from '../../state/capture'
import { openAudioMonitor, releaseAudioMonitor } from '../previewStream'

const BARS = 42
const floor = () => Array.from({ length: BARS }, () => 0.08)

// Frequency bars. Recording reads the recorder's analyser; otherwise a monitor
// stream draws the same spectrum so the bars stay put and only grow with level.
export function VoiceWave({ deviceId, recording }: { deviceId: string; recording: boolean }) {
  const [bars, setBars] = useState(floor)

  useEffect(() => {
    if (!recording) return
    let raf = 0
    const tick = () => {
      setBars(Array.from(readSpectrum()))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [recording])

  useEffect(() => {
    if (recording) return
    let gone = false
    let raf = 0
    let ctx: AudioContext | null = null
    void openAudioMonitor(deviceId).then((stream) => {
      if (!stream || gone) return
      ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 128
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const step = data.length / BARS
        const next = Array.from({ length: BARS }, (_, index) => {
          const start = Math.floor(index * step)
          const end = Math.max(start + 1, Math.floor((index + 1) * step))
          let sum = 0
          for (let i = start; i < end; i++) sum += data[i] ?? 0
          return Math.max(0.08, sum / (end - start) / 255)
        })
        setBars(next)
        raf = requestAnimationFrame(tick)
      }
      tick()
    })
    return () => {
      gone = true
      cancelAnimationFrame(raf)
      void ctx?.close()
      releaseAudioMonitor()
    }
  }, [deviceId, recording])

  return (
    <div className="room-desk-wave" data-live={recording || undefined} aria-hidden>
      {bars.map((value, index) => (
        <i key={index} style={{ transform: `scaleY(${value})` }} />
      ))}
    </div>
  )
}
