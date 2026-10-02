import { useEffect, useRef } from 'react'
import { registerController } from '../../media/controller'
import { useFittedPlayback } from './useFittedPlayback'

type Kind = 'audio' | 'video' | 'image'

export function EditPreview({ kind, url, imageUrl, buffer, durationMs, waveform, onPlaying }: {
  kind: Kind
  url: string
  imageUrl?: string
  buffer: AudioBuffer
  durationMs: number
  waveform?: number[]
  onPlaying?: (playing: boolean) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { progress, api } = useFittedPlayback(buffer, durationMs, videoRef, onPlaying)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    return registerController(el, api)
  }, [api])

  const still = kind === 'image' ? url : imageUrl

  return (
    <div ref={rootRef} className={still && kind !== 'video' ? 'stock-preview has-still' : 'stock-preview'}>
      {kind === 'video' && <video ref={videoRef} src={url} muted playsInline preload="auto" />}
      {still && kind !== 'video' && <img src={still} alt="" />}
      {kind === 'audio' && waveform && (
        <div className="stock-wave" aria-hidden>
          {waveform.map((peak, index) => (
            <i key={index} data-on={index / waveform.length <= progress ? '' : undefined} style={{ height: `${Math.max(10, peak * 100)}%` }} />
          ))}
        </div>
      )}
    </div>
  )
}
