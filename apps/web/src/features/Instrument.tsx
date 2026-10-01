import { motion, AnimatePresence, useAnimation, type PanInfo } from 'motion/react'
import { useUI } from '../state/ui'
import type { LocalMedia, SendInput } from '../api/types'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useMediaCapture } from './useMediaCapture'
import { useCapture } from '../state/capture'
import { useData } from '../state/data'
import { formatMoment } from '../utils/anchor'
import { findYouTubeVideoId, youTubeWatchUrl } from '@project/shared'
import { YouTubePreview, type YouTubePreviewResult } from '../components/YouTubePreview'
import { Media } from '../components/Media'
import { Control } from '../components/Control'
import { Label } from '../components/Label'
import { reveal, move } from '../styles/motion'
import { useShell } from '../state/shell'
import { captureKind, readDevice, useDevice } from '../state/device'
import { DevicePicker } from './DevicePicker'
import { KindMark, PreviewIcon } from '../components/icons'
import { CameraPreview } from './CameraPreview'

export function Instrument({ onSend }: { onSend: (input: SendInput) => Promise<void> }) {
  const ui = useUI()
  const capture = useMediaCapture()
  const controls = useAnimation()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  // Paste a YouTube link into the composer → preview → post (no separate import flow).
  const pastedYouTube = useMemo(() => findYouTubeVideoId(text), [text])
  const [ytPreview, setYtPreview] = useState<YouTubePreviewResult>({ status: 'loading' })
  const ytBlocksSend = !!pastedYouTube && (ytPreview.status === 'loading' || ytPreview.status === 'unavailable')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Set when a drag gesture happens on the record button, so the click that the
  // browser may fire on release doesn't toggle recording. Reset on every pointerdown.
  const draggedRef = useRef(false)

  const captureState = useCapture()
  const choice = useDevice((s) => s.choice)
  const armed = captureKind(choice)
  const camera = armed === 'video'
  // Choosing a camera opens the preview; the eye on the bar toggles it back off.
  const [previewOn, setPreviewOn] = useState(camera)
  useEffect(() => { setPreviewOn(camera) }, [choice])
  const recordOpen = useShell((s) => s.surface) === 'record' || ui.state === 'replying' || ui.state === 'recording' || ui.state === 'composing' || ui.state === 'reviewing'

  // Reply target as the room's sequence ("RE:007"), never the raw item id.
  const targetNumber = useData((s) => (ui.activeItemId ? s.itemsById[ui.activeItemId]?.number : undefined))
  const replyLabel =
    (targetNumber != null ? `RE:${String(targetNumber).padStart(3, '0')}` : 'RE:···') +
    (ui.replyAnchorMs != null ? ` · ${formatMoment(ui.replyAnchorMs)}` : '') // the captured moment, quietly


  const isRecording = ui.state === 'recording'
  const isReplying = ui.state === 'replying'
  const isSelected = ui.state === 'selected'
  const isComposing = ui.state === 'composing'
  const isReviewing = ui.state === 'reviewing'

  // Ensure target is visible above the bottom HUD when replying
  useEffect(() => {
    if (recordOpen && isReplying && ui.activeItemId) {
      const el = document.querySelector(`[data-item-id="${ui.activeItemId}"]`) || document.querySelector(`[data-reply-id="${ui.activeItemId}"]`) || document.getElementById(`item-${targetNumber}`)
      if (el) {
        // give layout a moment to settle
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
      }
    }
  }, [recordOpen, isReplying, ui.activeItemId, targetNumber])

  // Visual mass follows state: a light ring at rest, firmer while something plays,
  // dense (filled) only while recording.
  const mass = isRecording ? 'dense' : ui.state === 'playback' ? 'present' : 'rest'
  
  useEffect(() => {
    if (isComposing) inputRef.current?.focus()
  }, [isComposing])

  // Leave capture/compose: resume interrupted playback if there was one, else idle.
  // Reads fresh store state (handlers may run after awaits).
  const resume = () => {
    const { resumablePlaybackId, resumablePlaybackMode } = useCapture.getState()
    useCapture.getState().reset()
    if (resumablePlaybackId) ui.startPlayback(resumablePlaybackId, resumablePlaybackMode ?? 'chronological')
    else ui.setIdle()
    useShell.getState().minimizeRecord()
  }

  const startCapture = async (kind: 'audio' | 'video', deviceId = '') => {
    useShell.getState().openRecord()
    if (!readDevice()) useDevice.getState().select(useDevice.getState().choice)
    else useDevice.getState().setOpen(false)
    if (ui.state === 'playback') captureState.snapshotPlayback(ui.activeItemId, ui.playbackMode)
    ui.startRecording() // immediate feedback while the permission prompt resolves
    const ok = await capture.start(kind, deviceId)
    if (!ok) {
      const error = useCapture.getState().error ?? 'Recording unavailable'
      resume()
      ui.setError(error) // after resume(): setIdle() clears errors
    }
  }

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (!isRecording) return
    if (info.offset.y > 100) handleCancel()
    else controls.start({ x: 0, y: 0 })
  }

  const handleFinishVoice = () => {
    // Ignore until the recorder is actually running (permission may still be pending).
    if (useCapture.getState().phase !== 'recording') return
    capture.stop()
    ui.finishRecording()
  }

  const handleTextSend = async () => {
    if (!text.trim() || sending || ytBlocksSend) return
    setSending(true)
    try {
      if (pastedYouTube) {
        // The link becomes the video; whatever else was typed stays as the message text.
        const rest = text.replace(pastedYouTube.match, ' ').replace(/\s+/g, ' ').trim()
        await onSend({
          text: rest || undefined,
          media: [{
            kind: 'youtube',
            url: youTubeWatchUrl(pastedYouTube.id),
            durationMs: ytPreview.status === 'ready' ? ytPreview.durationMs : undefined,
            embeddable: ytPreview.status !== 'not-embeddable',
          }],
        })
      } else {
        await onSend({ text })
      }
    } catch (e) {
      ui.setError(`Send failed: ${e instanceof Error ? e.message : 'unknown error'}`)
      return // keep the draft
    } finally {
      setSending(false)
    }
    setText('')
    resume()
  }

  const handleMediaSend = async () => {
    if (!captureState.blob || !captureState.mode || sending) return
    const preview: LocalMedia = {
      type: captureState.mode,
      name: 'upload',
      file: captureState.blob,
      duration: captureState.durationMs / 1000, // API unit is seconds
    }

    setSending(true)
    captureState.prepare()
    captureState.upload()
    try {
      await onSend({ media: [preview] })
      captureState.complete()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown error'
      captureState.failUpload(message)
      ui.setError(`Upload failed: ${message}. Tap Send to retry.`) // blob is kept for retry
      return
    } finally {
      setSending(false)
    }
    resume()
  }

  const handleCancel = () => {
    capture.cancel()
    setText('')
    resume()
  }

  return (
    <AnimatePresence mode="wait">
    {!recordOpen && <MinRecord key="min" kind={armed} />}
    {recordOpen && !isSelected && (
    <motion.div 
      key="stage"
      className={isComposing || isReviewing ? "takeover" : "control-hud"}
      layoutId="instrument"
      {...(isComposing || isReviewing ? move : { ...reveal, layout: true })}
    >
      {!(isComposing || isReviewing) && (
        <button 
          type="button" 
          onClick={handleCancel} 
          style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', border: 0, fontSize: 28, cursor: 'pointer', color: 'var(--ink)', padding: 8, lineHeight: 1, zIndex: 10, opacity: 0.5 }}
          aria-label="Close"
        >
          ×
        </button>
      )}
      {isComposing ? (
        <>
          <div className="mode-label" style={{ opacity: 0.5 }}>{ui.activeItemId ? replyLabel : 'NEW MESSAGE'}</div>
          <motion.textarea 
            layoutId="instrument-core"
            ref={inputRef} 
            value={text} 
            onChange={e => setText(e.target.value)} 
            placeholder="Write something."
            style={{ 
              flex: 1, border: 0, outline: 0, resize: 'none', background: 'transparent', 
              color: 'var(--ink)', fontSize: 'clamp(48px, 12vw, 120px)', lineHeight: 1.0, 
              padding: '10vh 0 0', fontFamily: 'var(--sans)', letterSpacing: '-0.04em', fontWeight: 300 
            }}
          />
          {pastedYouTube && <YouTubePreview key={pastedYouTube.id} videoId={pastedYouTube.id} onResolved={setYtPreview} />}
          <div className="takeover-actions" style={{ display: 'flex', gap: 24, justifyContent: 'center', paddingBottom: 40 }}>
            <Control onClick={handleCancel} style={{ background: 'transparent', border: 0, opacity: 0.5, fontFamily: 'var(--sans)' }}>Cancel</Control>
            <Control 
              onClick={handleTextSend} 
              disabled={!text.trim() || sending || ytBlocksSend} 
              style={{ background: 'var(--ink)', color: 'var(--bg)', borderRadius: 999, padding: '16px 40px', fontFamily: 'var(--sans)', fontWeight: 600, border: 0 }}
            >
              Send
            </Control>
          </div>
        </>
      ) : isReviewing && captureState.previewUrl ? (
        <>
          <div className="mode-label" role={captureState.phase === 'uploadFailed' ? 'alert' : undefined} style={{ opacity: captureState.phase === 'uploadFailed' ? 1 : 0.5, color: captureState.phase === 'uploadFailed' ? 'var(--signal)' : undefined }}>
            {captureState.phase === 'uploadFailed' ? 'UPLOAD FAILED — RETRY' : sending ? 'SENDING…' : 'REVIEW'}
            {ui.activeItemId ? ` · ${replyLabel}` : ''}
          </div>
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', width: '100%', padding: '0 20px' }}>
            <div style={{ width: '100%', maxWidth: 400, borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Media 
                type={captureState.mode === 'video' ? 'video' : 'audio'} 
                src={captureState.previewUrl} 
                name="upload" 
                isActive={true}
                waveform={captureState.waveform}
              />
            </div>
          </div>
          <div className="takeover-actions" style={{ display: 'flex', gap: 16, justifyContent: 'center', paddingBottom: 40, alignItems: 'center' }}>
            <Control onClick={handleCancel} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 999, padding: '16px 24px', opacity: 0.8, fontFamily: 'var(--sans)' }}>Cancel</Control>
            {captureState.mode === 'video' && (
              <Control
                variant="default"
                className="sub-control"
                aria-label="Flip camera for retake"
                title="Flip camera for retake"
                onClick={() => {
                  const current = localStorage.getItem('camera_facing') || 'user'
                  localStorage.setItem('camera_facing', current === 'user' ? 'environment' : 'user')
                }}
              >
                ⟲
              </Control>
            )}
            <Control onClick={() => {
              const mode = captureState.mode === 'video' ? 'video' : 'audio'
              const current = useDevice.getState().choice
              const deviceId = captureKind(current) === mode ? current.deviceId : ''
              handleCancel()
              void startCapture(mode, deviceId)
            }} style={{ background: 'var(--muted)', color: 'var(--bg)', borderRadius: 999, padding: '16px 24px', fontFamily: 'var(--sans)' }}>Retake</Control>
            <Control 
              onClick={handleMediaSend} 
              disabled={sending}
              style={{ background: 'var(--ink)', color: 'var(--bg)', borderRadius: 999, padding: '16px 48px', fontFamily: 'var(--sans)', fontWeight: 600, border: 0 }}
            >
              Send
            </Control>
          </div>
        </>
      ) : (
        <div className="control-stack">
          <AnimatePresence mode="popLayout">
            {(isRecording || captureState.phase === 'arming') && (
              <motion.div 
                key="recording-label"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="control-label"
                aria-label={captureState.mode === 'video' ? 'Recording video' : 'Recording audio'}
                style={{ color: 'var(--signal)', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', flexDirection: 'column' }}
              >
                <KindMark kind={captureState.mode === 'video' ? 'video' : 'audio'} />
                {captureState.mode === 'audio' && (
                  <div style={{ display: 'flex', gap: 4, height: 24, alignItems: 'center' }}>
                    {[...Array(8)].map((_, i) => {
                      // Create a symmetric bell curve effect around the center for the meter
                      const pos = Math.abs(i - 3.5) / 3.5;
                      const activeMultiplier = 1 - (pos * 0.5);
                      // Map the level onto the height directly (no random jitter)
                      const height = Math.max(20, (captureState.level * 100 * activeMultiplier));
                      return (
                        <motion.div 
                          key={i} 
                          animate={{ height: `${height}%` }} 
                          transition={{ type: 'tween', ease: 'linear', duration: 0.1 }}
                          style={{ width: 6, background: 'currentColor', borderRadius: 3 }} 
                        />
                      )
                    })}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: 'bold' }}>RECORDING</span>
                  {ui.activeItemId && <span style={{ fontSize: '0.85em', opacity: 0.7, color: 'var(--ink)' }}>{replyLabel}</span>}
                </div>
              </motion.div>
            )}
            {isReplying && (
              <motion.div 
                key="reply-label"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="control-label"
              >
                {replyLabel}
              </motion.div>
            )}
          </AnimatePresence>

          {camera && previewOn && (
            <CameraPreview deviceId={choice.deviceId} recording={isRecording} />
          )}

          <Control
            variant="record"
            active={isRecording}
            data-mass={mass}
            onPointerDown={() => { draggedRef.current = false }}
            onClick={() => {
              if (draggedRef.current) { draggedRef.current = false; return }
              if (isRecording) handleFinishVoice()
              else void startCapture(armed, choice.deviceId)
            }}
            onDragStart={() => { draggedRef.current = true }}
            as={motion.button}
            layoutId="instrument-core"
            drag={isRecording ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.4}
            onDragEnd={handleDragEnd}
            animate={controls}
          >
            {isRecording ? '◉' : '●'}
          </Control>

          {!isRecording && (
            <motion.div className="sub-controls" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <DevicePicker />
              <div className="row">
              <Control
                variant="default"
                className="sub-control"
                type="button"
                aria-label={camera ? (previewOn ? 'Hide preview' : 'Show preview') : 'Preview'}
                title={camera ? 'Preview' : 'Select a camera to preview'}
                disabled={!camera}
                active={camera && previewOn}
                onClick={() => setPreviewOn((on) => !on)}
              >
                <PreviewIcon />
              </Control>
              <Control variant="default" className="sub-control" aria-label="Attach">+</Control>
              <Control variant="default" className="sub-control" aria-label="Write" onClick={() => { useShell.getState().openRecord(); ui.startComposing() }}>Aa</Control>
              </div>
            </motion.div>
          )}
        </div>
      )}
      
      {captureState.error && (
        <Label variant="status" className="error" role="alert">
          {captureState.error}
          <Control onClick={() => useCapture.setState({ error: null })}>×</Control>
        </Label>
      )}
    </motion.div>
    )}
    </AnimatePresence>
  )
}

function MinRecord({ kind }: { kind: 'audio' | 'video' }) {
  return (
    <motion.button
      type="button"
      className="record-min"
      aria-label="Record"
      layoutId="instrument-core"
      onClick={() => useShell.getState().openRecord()}
      initial={{ opacity: 0, scale: 0.84 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
    >
      <KindMark kind={kind} />
    </motion.button>
  )
}
