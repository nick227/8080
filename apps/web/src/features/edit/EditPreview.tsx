import { useEffect, useRef, type RefObject } from 'react'
import { registerController, type PlayableMediaController } from '../../media/controller'
import { useFittedPlayback } from './useFittedPlayback'
import { useLayeredPlayback } from './useLayeredPlayback'

type Kind = 'audio' | 'video' | 'image'

type Props = {
  kind: Kind
  url: string
  imageUrl?: string
  buffer: AudioBuffer
  durationMs: number
  waveform?: number[]
  onPlaying?: (playing: boolean) => void
}

export function EditPreview(props: Props) {
  return props.kind === 'video' ? <VideoPreview {...props} /> : <StillPreview {...props} />
}

function useRegistered(rootRef: RefObject<HTMLDivElement | null>, api: PlayableMediaController) {
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    return registerController(el, api)
  }, [rootRef, api])
}

// Video + soundtrack: the take plays untouched with the music layered under it.
function VideoPreview({ url, buffer, durationMs, onPlaying }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { api } = useLayeredPlayback(buffer, durationMs, videoRef, onPlaying)
  useRegistered(rootRef, api)
  return (
    <div ref={rootRef} className="stock-preview">
      <video ref={videoRef} src={url} playsInline preload="auto" />
    </div>
  )
}

// Audio take or a still: the fitted buffer is the clock.
function StillPreview({ kind, url, imageUrl, buffer, durationMs, waveform, onPlaying }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { progress, api } = useFittedPlayback(buffer, durationMs, videoRef, onPlaying)
  useRegistered(rootRef, api)
  const still = kind === 'image' ? url : imageUrl
  return (
    <div ref={rootRef} className={still ? 'stock-preview has-still' : 'stock-preview'}>
      {still && <img src={still} alt="" />}
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
