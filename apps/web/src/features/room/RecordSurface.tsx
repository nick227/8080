import { useEffect, useRef, useState } from 'react'
import { useUI } from '../../state/ui'
import { DevicePicker } from '../DevicePicker'
import { CameraPreview } from '../CameraPreview'
import { VoiceWave } from './VoiceWave'
import { Media } from '../../components/Media'
import { Control } from '../../components/Control'
import { KindMark } from '../../components/icons'
import { RecordButton } from './RecordStack'
import { YouTubePreview } from '../../components/YouTubePreview'
import { controllerWithin } from '../../media/controller'
import type { SendInput } from '../../api/types'
import { EditPreview } from '../edit/EditPreview'
import { EditSheet } from '../edit/EditSheet'
import type { PresenceActivity } from './PeopleStrip'
import { THUMB_ACCEPT, thumbFileProblem } from '../conversation/newConversation'
import { BackgroundStrip } from './BackgroundStrip'
import { useRecordSession } from './useRecordSession'

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
  const fileRef = useRef<HTMLInputElement>(null)
  const deskRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const session = useRecordSession({ replyName, compose, onClose, onSend, onActivity })
  const {
    capture, choice, waveform, stageRef,
    text, setText, frame, chooseFrame, ytText, setYtText, yt, upload, setUpload, clearUpload,
    playing, setPlaying, held, edit, pasted, recording,
    begin, back, send, previewType, previewSrc, showFile, showTake, showCamera, showWave,
    canSend, submitLabel, showPlay, showRetry, sections, previewKey, onYouTube, togglePlay, takeFile,
  } = session

  useEffect(() => {
    if (!previewKey) {
      edit.close()
      return
    }
    edit.show()
    // Phones: the sheet covers the bottom of the desk, so bring the actions up above it.
    if (!window.matchMedia('(max-width: 720px)').matches) return
    const timer = window.setTimeout(() => actionsRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 260)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey])

  useEffect(() => {
    if (compose) return
    deskRef.current?.querySelector<HTMLButtonElement>('.record-button')?.focus()
  }, [compose])

  return (
    <div ref={deskRef} className="room-desk" role="dialog" aria-label={replyName ? `Reply to ${replyName}` : 'Record'} data-review={showTake || (showFile && !!upload) || undefined}>
      <div className="room-desk-stack">
        <div className="room-desk-anchor">
        <div className="room-desk-meta">
          {identity && !replyName ? <IdentityField identity={identity} /> : (replyName || title) && <h2 className="room-desk-title">{replyName ? `Replying to ${replyName}` : title}</h2>}
        </div>
        <div className="room-desk-stage" ref={stageRef}>
          {frame === 'text' && (
            <div className="room-desk-write-wrap">
              <textarea
                className="room-desk-write"
                value={text}
                autoFocus
                placeholder="Write something."
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || !canSend) return
                  event.preventDefault()
                  void send()
                }}
              />
            </div>
          )}
          {frame === 'link' && (
            <div className="room-desk-card">
              <p className="room-desk-note">{yt.status === 'ready' && yt.title ? yt.title : 'YouTube'}</p>
            </div>
          )}
          {showFile && upload && previewType !== 'file' && previewSrc && held && held.kind !== 'text' && edit.fitted?.buffer && (
            <div className="room-desk-card" style={{ position: 'relative' }}>
              <EditPreview key={edit.fitted.trackId} kind={held.kind} url={held.url} imageUrl={edit.fitted.imageUrl} buffer={edit.fitted.buffer} durationMs={edit.fitted.durationMs} waveform={held.kind === 'audio' ? edit.fitted.waveform : undefined} onPlaying={setPlaying} />
            </div>
          )}
          {showFile && upload && previewType !== 'file' && previewSrc && !edit.fitted?.buffer && (
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
          {showCamera && <CameraPreview deviceId={choice.deviceId} recording={recording} />}
          {showWave && <VoiceWave deviceId={choice.deviceId} recording={recording} />}
        </div>
        {showCamera && !recording && <BackgroundStrip />}
        <RecordButton
          session={session}
          label={submitLabel}
          onRecord={() => void begin()}
          onStop={() => capture.stop()}
          onSubmit={() => void send()}
        />
        </div>

        <div className="room-desk-below">
          <div className="sub-controls" style={{ opacity: recording ? 0 : 1, pointerEvents: recording ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
            <DevicePicker />
            <div className="room-desk-subs">
              <Control variant="default" className="sub-control" type="button" aria-label="Microphone" active={frame === 'mic'} onClick={() => chooseFrame('mic')}><KindMark kind="audio" /></Control>
              <Control variant="default" className="sub-control" type="button" aria-label="Camera" active={frame === 'camera'} onClick={() => chooseFrame('camera')}><KindMark kind="video" /></Control>
              <Control variant="default" className="sub-control" type="button" aria-label="Write" active={frame === 'text'} onClick={() => chooseFrame('text')}>Aa</Control>
              <Control variant="default" className="sub-control" type="button" aria-label="Upload" onClick={() => fileRef.current?.click()}>+</Control>
            </div>
          </div>

          <div className="room-desk-actions" ref={actionsRef}>
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
            </span>
          </div>
        </div>
      </div>

      <EditSheet
        open={edit.open}
        sections={sections}
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
        takeFile(file)
      }} />
    </div>
  )
}
