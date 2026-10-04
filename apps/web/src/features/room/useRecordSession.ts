import { useEffect, useMemo, useRef, useState } from 'react'
import { findYouTubeVideoId, youTubeWatchUrl } from '@project/shared'
import { useUI } from '../../state/ui'
import { useCapture } from '../../state/capture'
import { captureKind, chooseKind, useDevice } from '../../state/device'
import { useMediaCapture } from '../useMediaCapture'
import { controllerWithin } from '../../media/controller'
import type { LocalMedia, MediaType, SendInput } from '../../api/types'
import { stopStockPreview } from '../edit/previewAudio'
import { encodeWav } from '../edit/encodeWav'
import { imageFile } from '../edit/stillTake'
import { takePicture, useStockEdit } from '../edit/useStockEdit'
import type { YouTubePreviewResult } from '../../components/YouTubePreview'
import type { PresenceActivity } from './PeopleStrip'
import { mainAction, type DeskFrame } from './deskAction'
import { useBackground } from '../../state/background'

export type RecordFrame = DeskFrame
type Upload = { file: File; url: string; type: MediaType }

export function useRecordSession({ replyName, compose = false, onClose, onSend, onActivity }: {
  replyName?: string
  compose?: boolean
  onClose: () => void
  onSend: (input: SendInput) => Promise<void>
  onActivity: (activity: PresenceActivity) => void
}) {
  const ui = useUI()
  const capture = useMediaCapture()
  const phase = useCapture((s) => s.phase)
  const previewUrl = useCapture((s) => s.previewUrl)
  const waveform = useCapture((s) => s.waveform)
  const mode = useCapture((s) => s.mode)
  const blob = useCapture((s) => s.blob)
  const durationMs = useCapture((s) => s.durationMs)
  const choice = useDevice((s) => s.choice)
  const kind = captureKind(choice)
  const stageRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [frame, setFrame] = useState<RecordFrame>(compose ? 'text' : kind === 'video' ? 'camera' : 'mic')
  const [ytText, setYtText] = useState('')
  const [yt, setYt] = useState<YouTubePreviewResult>({ status: 'loading' })
  const [upload, setUpload] = useState<Upload | null>(null)
  const [sending, setSending] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [playing, setPlaying] = useState(false)
  const held = frame === 'text' ? null : takePicture({ upload, mode, previewUrl, durationMs })
  const picture = held ?? { kind: 'text' as const }
  const edit = useStockEdit(picture)
  const pasted = useMemo(() => findYouTubeVideoId(ytText), [ytText])
  const recording = phase === 'arming' || phase === 'recording' || phase === 'stopping'
  const bgBlocking = useBackground((s) => s.mode !== 'original' && s.status !== 'ready' && s.status !== 'unavailable') && kind === 'video' && frame !== 'text'
  const take = !recording && !!(blob || upload)
  const ytReady = !!pasted && yt.status !== 'loading' && yt.status !== 'unavailable'

  useEffect(() => {
    setFrame((current) => (current === 'text' || current === 'file' || current === 'link' ? current : kind === 'video' ? 'camera' : 'mic'))
  }, [kind])
  useEffect(() => {
    onActivity(recording ? 'recording' : frame === 'text' && text.trim() ? 'typing' : 'here')
  }, [recording, frame, text, onActivity])
  useEffect(() => () => { if (upload) URL.revokeObjectURL(upload.url) }, [upload])

  const clearUpload = () => setUpload((current) => {
    if (current) URL.revokeObjectURL(current.url)
    return null
  })

  const begin = async () => {
    if (useCapture.getState().phase === 'arming' || useCapture.getState().phase === 'recording') return
    if (bgBlocking) return
    setYtText('')
    setYt({ status: 'loading' })
    if (useCapture.getState().blob) capture.cancel()
    clearUpload()
    setFrame(kind === 'video' ? 'camera' : 'mic')
    const deviceId = kind === 'audio' && choice.kind !== 'audioinput' ? '' : choice.deviceId
    const ok = await capture.start(kind, deviceId)
    if (!ok) ui.setError(useCapture.getState().error ?? 'Recording unavailable')
  }

  const chooseFrame = (next: RecordFrame) => {
    if (recording || next === frame) return
    capture.cancel()
    clearUpload()
    setYtText('')
    setYt({ status: 'loading' })
    setFrame(next)
    if (next === 'mic') void chooseKind('audio')
    if (next === 'camera') void chooseKind('video')
  }

  const discard = () => {
    capture.cancel()
    clearUpload()
  }

  const back = () => {
    const now = useCapture.getState().phase
    if (now === 'recording' || now === 'arming' || now === 'stopping' || useCapture.getState().blob || upload) {
      discard()
      return
    }
    if (frame === 'text' || frame === 'link' || frame === 'file') {
      setFrame(kind === 'video' ? 'camera' : 'mic')
      return
    }
    onClose()
  }

  const backRef = useRef(back)
  backRef.current = back
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (edit.open) {
        edit.close()
        return
      }
      backRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const send = async () => {
    if (sending || edit.fitting) return
    if (edit.open) edit.close()
    const note = text.trim() || undefined
    const media: SendInput['media'] = []
    const composite = !!(ytReady ? false : held && edit.fitted?.buffer)
    const renderCtx = composite ? new AudioContext() : null
    if (renderCtx) void renderCtx.resume()
    setSending(true)
    setRendering(composite)
    try {
      if (pasted && ytReady) {
        media.push({
          kind: 'youtube',
          url: youTubeWatchUrl(pasted.id),
          durationMs: yt.status === 'ready' ? yt.durationMs : undefined,
          embeddable: yt.status !== 'not-embeddable',
        })
      } else if (composite) {
        try {
          media.push(await edit.bake(renderCtx ?? undefined))
        } catch (cause) {
          ui.setError(cause instanceof Error ? cause.message : 'Could not render the clip')
          return
        }
      } else {
        if (blob && mode) media.push({ file: blob, type: mode, name: 'recording', duration: durationMs / 1000 } satisfies LocalMedia)
        else if (upload) media.push({ file: upload.file, type: upload.type, name: upload.file.name })
        if (picture.kind === 'text' && edit.fitted) {
          if (!blob && edit.fitted.buffer) {
            media.push({ file: encodeWav(edit.fitted.buffer), type: 'audio', name: 'edit.wav', duration: edit.fitted.durationMs / 1000 })
          }
          if (edit.fitted.imageUrl && upload?.type !== 'image') media.push(await imageFile(edit.fitted.imageUrl, edit.fitted.trackId))
        }
      }
      if (!note && !media.length) return
      await onSend({ text: note, media: media.length ? media : undefined })
    } finally {
      await renderCtx?.close()
      setSending(false)
      setRendering(false)
    }
  }

  const previewType = upload?.type ?? (mode === 'video' ? 'video' : 'audio')
  const previewSrc = upload?.url ?? previewUrl ?? undefined
  const showFile = frame === 'file' && !!upload
  const showTake = frame !== 'text' && frame !== 'link' && !showFile && take && !!previewSrc && previewType !== 'file'
  const showCamera = frame === 'camera' && !showTake && !showFile
  const showWave = frame === 'mic' && !showTake && !showFile
  const canSend = !!(text.trim() || take || blob || ytReady || edit.fitted?.buffer || edit.fitted?.imageUrl)
  const action = mainAction({ frame, recording, hasTake: !!(blob || upload) })
  const submitLabel = rendering ? 'Rendering' : sending ? (replyName ? 'Sending' : 'Saving') : (replyName ? 'Send' : 'Save')
  const showPlay = showTake && (previewType !== 'image' || !!edit.fitted?.buffer)
  const showRetry = showTake && previewType !== 'image'
  const capturedAudio = showTake && !upload && mode === 'audio'
  const sections = {
    audio: !capturedAudio,
    image: capturedAudio || frame === 'text',
    link: frame === 'text',
  }
  const previewKey = showTake ? `take:${previewSrc}`
    : showFile && upload && previewType !== 'file' ? `file:${upload.url}`
    : frame === 'text' ? 'text' : ''

  const onYouTube = (result: YouTubePreviewResult) => {
    setYt(result)
    if (result.status === 'loading' || result.status === 'unavailable') return
    capture.cancel()
    clearUpload()
    setFrame((current) => current === 'text' ? current : 'link')
  }

  const togglePlay = () => {
    const ctrl = controllerWithin(stageRef.current)
    if (playing) ctrl?.pause()
    else {
      stopStockPreview()
      void ctrl?.play()
    }
  }

  const takeFile = (file: File) => {
    const type: MediaType = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : file.type.startsWith('image') ? 'image' : 'file'
    setYtText('')
    setYt({ status: 'loading' })
    capture.cancel()
    clearUpload()
    setUpload({ file, url: URL.createObjectURL(file), type })
    setFrame('file')
  }

  const videoDeviceId = choice.kind === 'videoinput' ? choice.deviceId : ''

  return {
    capture, choice, kind, waveform, mode, blob, durationMs, stageRef,
    text, setText, frame, chooseFrame, ytText, setYtText, yt, upload, setUpload, clearUpload,
    sending, rendering, playing, setPlaying, held, edit, pasted, recording, bgBlocking, take, ytReady,
    begin, back, discard, send, previewType, previewSrc, showFile, showTake, showCamera, showWave,
    canSend, action, submitLabel, showPlay, showRetry, sections, previewKey, onYouTube, togglePlay, takeFile, videoDeviceId,
  }
}

export type RecordSession = ReturnType<typeof useRecordSession>
