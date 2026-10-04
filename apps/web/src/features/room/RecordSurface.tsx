import { useEffect, useMemo, useRef, useState } from 'react'
import { findYouTubeVideoId, youTubeWatchUrl } from '@project/shared'
import { useUI } from '../../state/ui'
import { useCapture } from '../../state/capture'
import { captureKind, chooseKind, useDevice } from '../../state/device'
import { useMediaCapture } from '../useMediaCapture'
import { DevicePicker } from '../DevicePicker'
import { CameraPreview } from '../CameraPreview'
import { VoiceWave } from './VoiceWave'
import { Media } from '../../components/Media'
import { Control } from '../../components/Control'
import { KindMark } from '../../components/icons'
import { YouTubePreview, type YouTubePreviewResult } from '../../components/YouTubePreview'
import { controllerWithin } from '../../media/controller'
import type { LocalMedia, MediaType, SendInput } from '../../api/types'
import { EditPreview } from '../edit/EditPreview'
import { EditSheet } from '../edit/EditSheet'
import { stopStockPreview } from '../edit/previewAudio'
import { encodeWav } from '../edit/encodeWav'
import { imageFile } from '../edit/stillTake'
import { takePicture, useStockEdit } from '../edit/useStockEdit'
import type { PresenceActivity } from './PeopleStrip'
import { THUMB_ACCEPT, thumbFileProblem } from '../conversation/newConversation'

function IdentityField({ identity }: { identity: ConversationIdentity }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(identity.title)
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => { setValue(identity.title) }, [identity.title])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const shown = preview ?? identity.thumbUrl

  return (
    <div className="room-desk-identity">
      <button type="button" className="room-desk-thumb" aria-label="Conversation image" onClick={() => fileRef.current?.click()}>
        {shown ? <img src={shown} alt="" /> : <span>+</span>}
      </button>
      <input ref={fileRef} type="file" accept={THUMB_ACCEPT} hidden onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        const problem = thumbFileProblem(file)
        if (problem) { useUI.getState().setError(problem); return }
        setPreview((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(file) })
        identity.onThumb(file)
      }} />
      <div className="room-desk-identity-text">
        <input
          className="room-desk-title-input"
          aria-label="Conversation title"
          placeholder={identity.onDescription ? 'Name' : undefined}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={(event) => {
            const next = event.currentTarget.value.trim()
            if (next !== identity.title) identity.onTitle(next)
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        />
        {identity.onDescription && (
          <textarea
            className="room-desk-description"
            aria-label="Conversation description"
            placeholder="What is this conversation about?"
            maxLength={500}
            rows={2}
            value={identity.description ?? ''}
            onChange={(event) => identity.onDescription!(event.target.value)}
          />
        )}
      </div>
    </div>
  )
}

const fileKind = (file: File): MediaType => {
  if (file.type.startsWith('video')) return 'video'
  if (file.type.startsWith('audio')) return 'audio'
  if (file.type.startsWith('image')) return 'image'
  return 'file'
}

type Upload = { file: File; url: string; type: MediaType }
type Frame = 'mic' | 'camera' | 'text' | 'file' | 'link'

export type ConversationIdentity = {
  title: string
  thumbUrl: string | null
  onTitle: (title: string) => void
  onThumb: (file: File) => void
  // New conversations also ask what it's about.
  description?: string
  onDescription?: (description: string) => void
}

export function RecordSurface({ replyName, title, identity, compose = false, onClose, onSend, onActivity }: {
  replyName?: string
  title?: string
  identity?: ConversationIdentity
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
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const sheetWasOpen = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [frame, setFrame] = useState<Frame>(compose ? 'text' : kind === 'video' ? 'camera' : 'mic')
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
  const take = !recording && !!(blob || upload)
  const ytReady = !!pasted && yt.status !== 'loading' && yt.status !== 'unavailable'

  useEffect(() => {
    if (sheetWasOpen.current && !edit.open) editButtonRef.current?.focus()
    sheetWasOpen.current = edit.open
  }, [edit.open])

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
    const soundLayer = frame === 'text'
    setYtText('')
    setYt({ status: 'loading' })
    if (useCapture.getState().blob) capture.cancel()
    if (!soundLayer) {
      clearUpload()
      setFrame(kind === 'video' ? 'camera' : 'mic')
    } else if (upload && upload.type !== 'image') clearUpload()
    const recordKind = soundLayer ? 'audio' : kind
    const deviceId = recordKind === 'audio' && choice.kind !== 'audioinput' ? '' : choice.deviceId
    const ok = await capture.start(recordKind, deviceId)
    if (!ok) ui.setError(useCapture.getState().error ?? 'Recording unavailable')
  }

  const back = () => {
    const now = useCapture.getState().phase
    if (now === 'recording' || now === 'arming' || now === 'stopping' || useCapture.getState().blob || upload) {
      capture.cancel()
      clearUpload()
      return
    }
    if (frame === 'text' || frame === 'link' || frame === 'file') {
      setFrame(kind === 'video' ? 'camera' : 'mic')
      return
    }
    onClose()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (edit.open) {
        edit.close()
        return
      }
      back()
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
  const showPlay = showTake && (previewType !== 'image' || !!edit.fitted?.buffer)
  const showRetry = showTake && previewType !== 'image'

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

  return (
    <div className="room-desk" role="dialog" aria-label={replyName ? `Reply to ${replyName}` : 'Record'}>
      <div className="room-desk-stack">
        <div className="room-desk-anchor">
        <div className="room-desk-meta">
          {identity && !replyName ? <IdentityField identity={identity} /> : (replyName || title) && <h2 className="room-desk-title">{replyName ? `Replying to ${replyName}` : title}</h2>}
        </div>
        <div className="room-desk-stage" ref={stageRef}>
          {frame === 'text' && (
            <div className="room-desk-write-wrap">
              <textarea className="room-desk-write" value={text} autoFocus placeholder="Write something." onChange={(event) => setText(event.target.value)} />
            </div>
          )}
          {frame === 'link' && (
            <div className="room-desk-card">
              <p className="room-desk-note">{yt.status === 'ready' && yt.title ? yt.title : 'YouTube'}</p>
            </div>
          )}
          {showFile && upload && previewType !== 'file' && previewSrc && (
            <div className="room-desk-card">
              <Media type={previewType === 'image' ? 'image' : previewType} src={previewSrc} name={upload.file.name} waveform={previewType === 'audio' ? waveform ?? undefined : undefined} hidePlayButton isActive={false} onPlayStatusChange={setPlaying} />
            </div>
          )}
          {showFile && previewType === 'file' && upload && (
            <div className="room-desk-card"><p className="room-desk-file">{upload.file.name}</p></div>
          )}
          {showTake && previewSrc && held && held.kind !== 'text' && (
            <div className={held.kind === 'audio' && edit.fitted?.imageUrl ? 'room-desk-card is-still' : 'room-desk-card'} style={{ position: 'relative' }}>
              {edit.fitted?.buffer ? (
                <EditPreview key={edit.fitted.trackId} kind={held.kind} url={held.url} imageUrl={edit.fitted.imageUrl} buffer={edit.fitted.buffer} durationMs={edit.fitted.durationMs} waveform={held.kind === 'audio' ? edit.fitted.waveform : undefined} onPlaying={setPlaying} />
              ) : (
                <Media type={previewType === 'image' ? 'image' : previewType} src={previewSrc} name={upload?.file.name ?? 'take'} waveform={previewType === 'audio' ? waveform ?? undefined : undefined} hidePlayButton isActive={false} onPlayStatusChange={setPlaying} />
              )}
            </div>
          )}
          {showCamera && <CameraPreview recording={recording} />}
          {showWave && <VoiceWave deviceId={choice.deviceId} recording={recording} />}
        </div>
        <Control variant="record" type="button" active={recording} data-mass={recording ? 'dense' : 'rest'} aria-label={recording ? 'Stop' : 'Record'} onClick={() => (recording ? capture.stop() : void begin())}>
          <span style={{ display: 'grid', placeItems: 'center', width: '1em', height: '1em' }}>
            {recording ? '◉' : '●'}
          </span>
        </Control>
        </div>

        <div className="room-desk-below">
          <div className="sub-controls" style={{ opacity: recording ? 0 : 1, pointerEvents: recording ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
            <DevicePicker />
            <div className="room-desk-subs">
              <Control variant="default" className="sub-control" type="button" aria-label="Microphone" active={frame === 'mic'} onClick={() => { setFrame('mic'); void chooseKind('audio') }}><KindMark kind="audio" /></Control>
              <Control variant="default" className="sub-control" type="button" aria-label="Camera" active={frame === 'camera'} onClick={() => { setFrame('camera'); void chooseKind('video') }}><KindMark kind="video" /></Control>
              <Control variant="default" className="sub-control" type="button" aria-label="Write" active={frame === 'text'} onClick={() => setFrame('text')}>Aa</Control>
              <Control variant="default" className="sub-control" type="button" aria-label="Upload" onClick={() => fileRef.current?.click()}>+</Control>
            </div>
          </div>

          <div className="room-desk-actions">
            <span className="room-desk-take-actions" style={{
              opacity: recording ? 0 : 1,
              pointerEvents: recording ? 'none' : 'auto',
              transition: 'opacity 0.2s',
              visibility: recording ? 'hidden' : 'visible'
            }}>
            {/* Hidden while recording like the rest; Escape still aborts a take. */}
            <button type="button" className="room-desk-cancel" onClick={back}>Cancel</button>
            {showPlay && (
              <button type="button" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
            )}
            {showRetry && <button type="button" onClick={() => { capture.cancel(); clearUpload(); void begin() }}>RETRY</button>}
            <button ref={editButtonRef} type="button" aria-pressed={edit.open} aria-expanded={edit.open} data-armed={edit.fitted || ytReady ? '' : undefined} onClick={edit.toggle}>Attach</button>
            <button type="button" disabled={sending || edit.fitting || !canSend} onClick={() => void send()}>{rendering ? 'Rendering' : sending ? (replyName ? 'Sending' : 'Saving') : (replyName ? 'Send' : 'Save')}</button>
            </span>
          </div>
        </div>
      </div>

      <EditSheet
        open={edit.open}
        trackId={edit.trackId}
        uploadUrl={edit.trackId === 'upload' ? edit.fitted?.imageUrl : null}
        link={ytText}
        fitting={edit.fitting}
        onSelect={edit.select}
        onUpload={edit.uploadImage}
        onLink={setYtText}
        onClose={edit.close}
        onPauseTake={() => controllerWithin(stageRef.current)?.pause()}
      />

      {pasted && (
        <div className="room-desk-probe" aria-hidden>
          <YouTubePreview key={pasted.id} videoId={pasted.id} onResolved={onYouTube} />
        </div>
      )}

      <input ref={fileRef} type="file" hidden onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setYtText('')
        setYt({ status: 'loading' })
        capture.cancel()
        clearUpload()
        setUpload({ file, url: URL.createObjectURL(file), type: fileKind(file) })
        setFrame('file')
      }} />
    </div>
  )
}
