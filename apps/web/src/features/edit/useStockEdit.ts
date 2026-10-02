import { useEffect, useRef, useState } from 'react'
import type { LocalMedia, MediaType } from '../../api/types'
import { useUI } from '../../state/ui'
import { composeClip } from './composeClip'
import { encodeWav } from './encodeWav'
import { bufferDurationMs, decodeStock, fitAudio, readDurationMs, waveformPeaks } from './fitAudio'
import { stockTrack, stockImage } from './stock'

export type TakePicture =
  | { kind: 'audio'; url: string; durationMs: number }
  | { kind: 'video'; url: string; durationMs: number }
  | { kind: 'image'; url: string }

export type FittedTake = {
  trackId: string
  buffer: AudioBuffer
  durationMs: number
  waveform: number[]
  imageUrl?: string
}

export function takePicture(input: {
  upload: { url: string; type: MediaType } | null
  mode: 'audio' | 'video' | null
  previewUrl: string | null
  durationMs: number
}): TakePicture | null {
  const { upload, mode, previewUrl, durationMs } = input
  if (upload?.type === 'image') return { kind: 'image', url: upload.url }
  if (upload?.type === 'audio' || upload?.type === 'video') return { kind: upload.type, url: upload.url, durationMs: 0 }
  if (upload?.type === 'file') return null
  if (previewUrl && mode) return { kind: mode, url: previewUrl, durationMs }
  return null
}

export function useStockEdit(picture: TakePicture | null) {
  const setError = useUI(s => s.setError)
  const [open, setOpen] = useState(false)
  const [trackId, setTrackId] = useState<string | null>(null)
  const [fitted, setFitted] = useState<FittedTake | null>(null)
  const [fitting, setFitting] = useState(false)
  const pictureRef = useRef(picture)
  const fittedRef = useRef(fitted)
  const request = useRef(0)
  pictureRef.current = picture
  fittedRef.current = fitted
  const sourceKey = picture ? `${picture.kind}:${picture.url}` : ''

  useEffect(() => {
    request.current += 1
    setOpen(false)
    setTrackId(null)
    setFitted(null)
    setFitting(false)
  }, [sourceKey])

  const select = (id: string | null) => {
    const token = ++request.current
    const current = pictureRef.current
    if (!id || !current) {
      setTrackId(null)
      setFitted(null)
      setFitting(false)
      return
    }
    setTrackId(id)
    setFitting(true)
    void (async () => {
      try {
        if (current.kind === 'audio') {
          const stockImg = stockImage(id)
          const durationMs = current.durationMs > 0 ? current.durationMs : await readDurationMs(current.url, current.kind)
          if (token !== request.current) return
          const buffer = await decodeStock(current.url)
          if (token !== request.current) return
          setFitted({ trackId: id, buffer, durationMs, waveform: waveformPeaks(buffer), imageUrl: stockImg.url })
          setError(undefined)
        } else {
          const stock = await decodeStock(stockTrack(id).url)
          if (token !== request.current) return
          const durationMs = current.kind === 'image'
            ? bufferDurationMs(stock)
            : current.durationMs > 0 ? current.durationMs : await readDurationMs(current.url, current.kind)
          if (token !== request.current) return
          const buffer = current.kind === 'image' ? stock : fitAudio(stock, durationMs)
          setFitted({ trackId: id, buffer, durationMs, waveform: waveformPeaks(buffer) })
          setError(undefined)
        }
      } catch (cause) {
        if (token !== request.current) return
        setTrackId(null)
        setFitted(null)
        setError(cause instanceof Error ? cause.message : 'Could not load that track')
      } finally {
        if (token === request.current) setFitting(false)
      }
    })()
  }

  const bake = async (audioCtx?: AudioContext): Promise<LocalMedia> => {
    const current = pictureRef.current
    const edit = fittedRef.current
    if (!current || !edit) throw new Error('Nothing to render')
    if (current.kind === 'audio') {
      if (!edit.imageUrl) {
        return { file: encodeWav(edit.buffer), type: 'audio', name: 'edit.wav', duration: edit.durationMs / 1000 }
      }
      if (!audioCtx) throw new Error('Could not render the clip')
      const file = await composeClip({ kind: 'image', url: edit.imageUrl }, edit.buffer, edit.durationMs, audioCtx)
      const ext = file.type === 'video/mp4' ? 'mp4' : 'webm'
      return { file, type: 'video', name: `edit.${ext}`, duration: edit.durationMs / 1000 }
    }
    if (!audioCtx) throw new Error('Could not render the clip')
    const file = await composeClip({ kind: current.kind, url: current.url }, edit.buffer, edit.durationMs, audioCtx)
    const ext = file.type === 'video/mp4' ? 'mp4' : 'webm'
    return { file, type: 'video', name: `edit.${ext}`, duration: edit.durationMs / 1000 }
  }

  return {
    open,
    toggle: () => setOpen(on => !on),
    close: () => setOpen(false),
    trackId,
    fitted,
    fitting,
    select,
    bake,
  }
}
