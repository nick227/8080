import { useEffect, useMemo, useRef, useState } from 'react'
import { findYouTubeVideoId, youTubeWatchUrl } from '@project/shared'
import { useUI } from '../../state/ui'
import { useCapture } from '../../state/capture'
import { captureKind, useDevice } from '../../state/device'
import { useMediaCapture } from '../useMediaCapture'
import { DevicePicker } from '../DevicePicker'
import { CameraPreview } from '../CameraPreview'
import { VoiceWave } from './VoiceWave'
import { Media } from '../../components/Media'
import { Control } from '../../components/Control'
import { PreviewIcon } from '../../components/icons'
import { YouTubePreview, type YouTubePreviewResult } from '../../components/YouTubePreview'
import { controllerWithin } from '../../media/controller'
import type { LocalMedia, MediaType, SendInput } from '../../api/types'
import { EditPreview } from '../edit/EditPreview'
import { EditSheet } from '../edit/EditSheet'
import { stopStockPreview } from '../edit/previewAudio'
import { takePicture, useStockEdit } from '../edit/useStockEdit'
import type { PresenceActivity } from './PeopleStrip'

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
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setPreview((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(file) })
        identity.onThumb(file)
      }} />
      <input
        className="room-desk-title-input"
        aria-label="Conversation title"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim()
          if (next && next !== identity.title) identity.onTitle(next)
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      />
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

export type ConversationIdentity = {
  title: string
  thumbUrl: string | null
  onTitle: (title: string) => void
  onThumb: (file: File) => void
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
  const [write, setWrite] = useState(compose)
  const [ytOpen, setYtOpen] = useState(false)
  const [ytText, setYtText] = useState('')
  const [yt, setYt] = useState<YouTubePreviewResult>({ status: 'loading' })
  const [upload, setUpload] = useState<Upload | null>(null)
  const [previewOn, setPreviewOn] = useState(kind === 'video')
  const [sending, setSending] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [playing, setPlaying] = useState(false)
  const picture = takePicture({ upload, mode, previewUrl, durationMs })
  const edit = useStockEdit(picture)
  const pasted = useMemo(() => findYouTubeVideoId(ytText), [ytText])

  const recording = phase === 'arming' || phase === 'recording' || phase === 'stopping'
  const take = !recording && !!(blob || upload)
  const ytReady = ytOpen && !!pasted && yt.status !== 'loading' && yt.status !== 'unavailable'

  useEffect(() => {
    if (sheetWasOpen.current && !edit.open) editButtonRef.current?.focus()
    sheetWasOpen.current = edit.open
  }, [edit.open])

  useEffect(() => { setPreviewOn(kind === 'video') }, [choice])
  useEffect(() => {
    onActivity(recording ? 'recording' : write && text.trim() ? 'typing' : 'here')
  }, [recording, write, text, onActivity])
  useEffect(() => () => { if (upload) URL.revokeObjectURL(upload.url) }, [upload])

  const clearUpload = () => setUpload((current) => {
    if (current) URL.revokeObjectURL(current.url)
    return null
  })

  const begin = async () => {
    if (useCapture.getState().phase === 'arming' || useCapture.getState().phase === 'recording') return
    if (useCapture.getState().blob || upload) {
      capture.cancel()
    }
    clearUpload()
    const ok = await capture.start(kind, choice.deviceId)
    if (!ok) ui.setError(useCapture.getState().error ?? 'Recording unavailable')
  }

  const back = () => {
    const now = useCapture.getState().phase
    if (now === 'recording' || now === 'arming' || now === 'stopping' || useCapture.getState().blob || upload) {
      capture.cancel()
      clearUpload()
      return
    }
    if (write || ytOpen) {
      setWrite(false)
      setYtOpen(false)
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
    const note = (write ? text.trim() : '') || undefined
    const media: SendInput['media'] = []
    const visual = !!(edit.fitted && picture && picture.kind !== 'audio')
    const renderCtx = visual ? new AudioContext() : null
    if (renderCtx) void renderCtx.resume()
    setSending(true)
    setRendering(visual)
    try {
      if (edit.fitted && picture) {
        try {
          media.push(await edit.bake(renderCtx ?? undefined))
        } catch (cause) {
          ui.setError(cause instanceof Error ? cause.message : 'Could not render the clip')
          return
        }
      } else if (blob && mode) media.push({ file: blob, type: mode, name: 'recording', duration: durationMs / 1000 } satisfies LocalMedia)
      else if (upload) media.push({ file: upload.file, type: upload.type, name: upload.file.name })
      if (pasted && ytReady) {
        media.push({
          kind: 'youtube',
          url: youTubeWatchUrl(pasted.id),
          durationMs: yt.status === 'ready' ? yt.durationMs : undefined,
          embeddable: yt.status !== 'not-embeddable',
        })
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
  const entry = write || ytOpen
  const showCamera = !entry && !take && kind === 'video' && (recording || previewOn)
  const canSend = !!((write && text.trim()) || take || ytReady)
  const canEdit = take && !entry && previewType !== 'file' && !!picture
  const showPlay = canEdit && (previewType !== 'image' || !!edit.fitted)
  const showRetry = take && !entry && previewType !== 'image' && previewType !== 'file'

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
          <button type="button" className="room-desk-cancel" onClick={back}>Cancel</button>
        </div>
        <div className="room-desk-stage" ref={stageRef}>
          {write && (
            <textarea className="room-desk-write" value={text} autoFocus placeholder="Write something." onChange={(event) => setText(event.target.value)} />
          )}
          {ytOpen && (
            <div className="room-desk-card">
              <input className="room-desk-link" value={ytText} autoFocus placeholder="YouTube link" onChange={(event) => setYtText(event.target.value)} />
              {pasted && yt.status === 'ready' && yt.title && <p className="room-desk-note">{yt.title}</p>}
            </div>
          )}
          {!entry && take && previewSrc && previewType !== 'file' && (
            <div className="room-desk-card" style={{ position: 'relative' }}>
              {edit.fitted && picture ? (
                <EditPreview key={edit.fitted.trackId} kind={picture.kind} url={picture.url} buffer={edit.fitted.buffer} durationMs={edit.fitted.durationMs} waveform={picture.kind === 'audio' ? edit.fitted.waveform : undefined} onPlaying={setPlaying} />
              ) : (
                <Media type={previewType === 'image' ? 'image' : previewType} src={previewSrc} name={upload?.file.name ?? 'take'} waveform={previewType === 'audio' ? waveform ?? undefined : undefined} isActive={false} onPlayStatusChange={setPlaying} />
              )}
            </div>
          )}
          {!entry && take && previewType === 'file' && (
            <div className="room-desk-card"><p className="room-desk-file">{upload?.file.name}</p></div>
          )}
          {showCamera && <CameraPreview deviceId={choice.deviceId} recording={recording} />}
          {!entry && !take && kind === 'audio' && <VoiceWave deviceId={choice.deviceId} recording={recording} />}
          {!entry && !take && kind === 'video' && !showCamera && <div className="room-desk-card"><p className="room-desk-file">Camera off</p></div>}
        </div>
        <Control variant="record" type="button" active={recording} data-mass={recording ? 'dense' : 'rest'} aria-label={recording ? 'Stop' : 'Record'} onClick={() => (recording ? capture.stop() : void begin())}>
          {recording ? '◉' : '●'}
        </Control>
        </div>

        <div className="room-desk-below">
          <div className="sub-controls" style={{ opacity: recording ? 0 : 1, pointerEvents: recording ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
            <DevicePicker />
            <div className="room-desk-subs">
              <Control variant="default" className="sub-control" type="button" aria-label={previewOn ? 'Hide preview' : 'Show preview'} disabled={kind !== 'video'} active={previewOn && kind === 'video'} onClick={() => setPreviewOn((on) => !on)}>
                <PreviewIcon />
              </Control>
              <Control variant="default" className="sub-control" type="button" aria-label="Upload" onClick={() => fileRef.current?.click()}>+</Control>
              <Control variant="default" className="sub-control" type="button" aria-label="Write" active={write} onClick={() => { setWrite((on) => !on); setYtOpen(false) }}>Aa</Control>
              <Control variant="default" className="sub-control" type="button" aria-label="YouTube link" active={ytOpen} onClick={() => { setYtOpen((on) => !on); setWrite(false) }}>YT</Control>
            </div>
          </div>

          <div className="room-desk-actions" style={{ 
            opacity: canSend && !recording ? 1 : 0, 
            pointerEvents: canSend && !recording ? 'auto' : 'none', 
            transition: 'opacity 0.2s',
            height: canSend && !recording ? 'auto' : 0,
            overflow: 'hidden'
          }}>
            {showPlay && (
              <button type="button" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
            )}
            {showRetry && <button type="button" onClick={() => { capture.cancel(); clearUpload(); void begin() }}>RETRY</button>}
            {canEdit && (
              <button ref={editButtonRef} type="button" aria-pressed={edit.open} aria-expanded={edit.open} data-armed={edit.fitted ? '' : undefined} onClick={edit.toggle}>Edit</button>
            )}
            {edit.fitted && !edit.open && <button type="button" onClick={() => edit.select(null)}>Remove</button>}
            <button type="button" disabled={sending || edit.fitting || !canSend} onClick={() => void send()}>{rendering ? 'Rendering' : sending ? (replyName ? 'Sending' : 'Saving') : (replyName ? 'Send' : 'Save')}</button>
          </div>
        </div>
      </div>

      <EditSheet
        open={canEdit && edit.open}
        trackId={edit.trackId}
        fitting={edit.fitting}
        playing={playing}
        canPlay={showPlay}
        onSelect={edit.select}
        onClose={edit.close}
        onTogglePlay={togglePlay}
        onPauseTake={() => controllerWithin(stageRef.current)?.pause()}
      />

      {ytOpen && pasted && (
        <div className="room-desk-probe" aria-hidden>
          <YouTubePreview key={pasted.id} videoId={pasted.id} onResolved={setYt} />
        </div>
      )}

      <input ref={fileRef} type="file" hidden onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setWrite(false)
        setYtOpen(false)
        capture.cancel()
        clearUpload()
        setUpload({ file, url: URL.createObjectURL(file), type: fileKind(file) })
      }} />
    </div>
  )
}
