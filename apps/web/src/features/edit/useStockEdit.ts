import { useEffect, useRef, useState } from 'react'
import type { LocalMedia, MediaType } from '../../api/types'
import { useUI } from '../../state/ui'
import { composeClip } from './composeClip'
import { encodeWav } from './encodeWav'
import { bufferDurationMs, decodeStock, waveformPeaks } from './fitAudio'
import { imageFile, stillTake } from './stillTake'
import { STOCK_IMAGES, stockImage, stockTrack } from './stock'

export type TakePicture =
  | { kind: 'audio'; url: string; durationMs: number }
  | { kind: 'video'; url: string; durationMs: number }
  | { kind: 'image'; url: string }
  | { kind: 'text' }

export type FittedTake = {
  trackId: string
  buffer: AudioBuffer | null
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
  const owned = useRef<string | null>(null)
  pictureRef.current = picture
  fittedRef.current = fitted
  const sourceKey = picture ? `${picture.kind}:${'url' in picture ? picture.url : ''}` : ''

  const dropOwned = (url: string | null) => {
    if (!url) return
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const releaseOwned = () => {
    dropOwned(owned.current)
    owned.current = null
  }

  useEffect(() => {
    request.current += 1
    setOpen(false)
    setTrackId(null)
    setFitted(null)
    setFitting(false)
    return () => {
      const url = owned.current
      owned.current = null
      if (url) window.setTimeout(() => URL.revokeObjectURL(url), 0)
    }
  }, [sourceKey])

  const commit = (token: number, next: FittedTake, blobUrl: string | null) => {
    if (token !== request.current) {
      dropOwned(blobUrl)
      return
    }
    const prev = owned.current
    owned.current = blobUrl
    if (prev && prev !== blobUrl) dropOwned(prev)
    setTrackId(next.trackId)
    setFitted(next)
    setError(undefined)
  }

  const fail = (token: number, blobUrl: string | null, cause: unknown) => {
    dropOwned(blobUrl)
    if (token !== request.current) return
    setError(cause instanceof Error ? cause.message : 'Could not apply that')
  }

  const select = (id: string | null) => {
    const token = ++request.current
    const current = pictureRef.current
    if (!id || !current) {
      releaseOwned()
      setTrackId(null)
      setFitted(null)
      setFitting(false)
      return
    }
    setFitting(true)
    void (async () => {
      try {
        if (STOCK_IMAGES.some((item) => item.id === id)) {
          if (current.kind !== 'text' && current.kind !== 'audio') return
          const next = await stillTake(current, stockImage(id).url, token, request)
          if (!next) return
          commit(token, { ...next, trackId: id }, null)
          return
        }
        const stock = await decodeStock(stockTrack(id).url)
        if (current.kind === 'text' || current.kind === 'audio') {
          if (token !== request.current) return
          commit(token, {
            trackId: id,
            buffer: stock,
            durationMs: bufferDurationMs(stock),
            waveform: waveformPeaks(stock),
            imageUrl: fittedRef.current?.imageUrl,
          }, null)
          return
        }
        if (token !== request.current) return
        if (current.kind === 'video') {
          // Nothing is fitted or rendered for video: the preview layers the raw track
          // under the take, and Save mixes + remuxes once (remuxSoundtrack.ts).
          commit(token, { trackId: id, buffer: stock, durationMs: current.durationMs, waveform: waveformPeaks(stock) }, null)
          return
        }
        commit(token, { trackId: id, buffer: stock, durationMs: bufferDurationMs(stock), waveform: waveformPeaks(stock) }, null)
      } catch (cause) {
        fail(token, null, cause)
      } finally {
        if (token === request.current) setFitting(false)
      }
    })()
  }

  const uploadImage = (file: File) => {
    const current = pictureRef.current
    if (!current || (current.kind !== 'audio' && current.kind !== 'text')) return
    const token = ++request.current
    const imageUrl = URL.createObjectURL(file)
    setFitting(true)
    void (async () => {
      try {
        const next = await stillTake(current, imageUrl, token, request)
        if (!next) {
          dropOwned(imageUrl)
          return
        }
        commit(token, { ...next, trackId: 'upload' }, imageUrl)
      } catch (cause) {
        fail(token, imageUrl, cause)
      } finally {
        if (token === request.current) setFitting(false)
      }
    })()
  }

  const bake = async (audioCtx?: AudioContext): Promise<LocalMedia> => {
    const current = pictureRef.current
    const edit = fittedRef.current
    if (!current || !edit) throw new Error('Nothing to render')
    if (current.kind === 'text') {
      if (!edit.imageUrl) throw new Error('Nothing to render')
      return imageFile(edit.imageUrl, edit.trackId)
    }
    if (!edit.buffer) throw new Error('Nothing to render')
    if (current.kind === 'audio') {
      if (!edit.imageUrl) {
        return { file: encodeWav(edit.buffer), type: 'audio', name: 'edit.wav', duration: edit.durationMs / 1000 }
      }
      if (!audioCtx) throw new Error('Could not render the clip')
      const file = await composeClip({ kind: 'image', url: edit.imageUrl }, edit.buffer, edit.durationMs, audioCtx)
      const ext = file.type === 'video/mp4' ? 'mp4' : 'webm'
      return { file, type: 'video', name: `edit.${ext}`, duration: edit.durationMs / 1000 }
    }
    if (current.kind === 'video') {
      // Loaded on demand: the muxer is only needed at Save.
      const [{ remuxWithSoundtrack }, take] = await Promise.all([import('./remuxSoundtrack'), fetch(current.url).then((r) => r.blob())])
      const { file, durationMs } = await remuxWithSoundtrack(take, edit.buffer)
      const ext = file.type === 'video/mp4' ? 'mp4' : 'webm'
      return { file, type: 'video', name: `edit.${ext}`, duration: durationMs / 1000 }
    }
    if (!audioCtx) throw new Error('Could not render the clip')
    const file = await composeClip({ kind: 'image', url: current.url }, edit.buffer, edit.durationMs, audioCtx)
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
    uploadImage,
    bake,
  }
}
