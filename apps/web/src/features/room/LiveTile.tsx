import { useState } from 'react'
import { CameraPreview } from '../CameraPreview'
import { useMediaCapture } from '../useMediaCapture'
import { PersonIcon } from '../../components/icons'
import { useCapture } from '../../state/capture'
import { useDevice } from '../../state/device'
import { useUI } from '../../state/ui'
import type { SendInput } from '../../api/types'
import type { PresenceActivity } from './PeopleStrip'
import type { Seat } from './roomViews'

function Face({ seat }: { seat: Seat }) {
  return (
    <span className="room-seat" data-photo={seat.avatarUrl ? '' : undefined} data-activity={seat.activity ?? undefined}>
      {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
    </span>
  )
}

export function LiveTile({ seat, onSend, onActivity }: {
  seat: Seat
  onSend: (input: SendInput) => Promise<void>
  onActivity: (activity: PresenceActivity) => void
}) {
  const capture = useMediaCapture()
  const phase = useCapture((s) => s.phase)
  const blob = useCapture((s) => s.blob)
  const previewUrl = useCapture((s) => s.previewUrl)
  const mode = useCapture((s) => s.mode)
  const durationMs = useCapture((s) => s.durationMs)
  const deviceId = useDevice((s) => (s.choice.kind === 'videoinput' ? s.choice.deviceId : ''))
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const recording = phase === 'arming' || phase === 'recording' || phase === 'stopping'
  const review = phase === 'review' && !!previewUrl

  const begin = async () => {
    onActivity('recording')
    const ok = await capture.start('video', deviceId)
    if (!ok) {
      onActivity('here')
      useUI.getState().setError(useCapture.getState().error ?? 'Camera unavailable')
    }
  }

  const close = () => {
    capture.cancel()
    onActivity('here')
    setOpen(false)
  }

  const submit = async () => {
    if (!blob || !mode || sending) return
    setSending(true)
    await onSend({ media: [{ file: blob, type: mode, name: 'live', duration: durationMs / 1000 }] })
    setSending(false)
    if (useUI.getState().error) return
    close()
  }

  if (!open) {
    return (
      <button type="button" className="room-cast-face" aria-label={`${seat.name}, go live`} onClick={() => setOpen(true)}>
        <Face seat={seat} />
        <span className="room-seat-name">{seat.name}</span>
      </button>
    )
  }

  return (
    <div className="room-cast-live" data-recording={recording || undefined}>
      {review ? <video src={previewUrl} muted playsInline autoPlay loop /> : <CameraPreview deviceId={deviceId} recording={recording} />}
      <div className="room-cast-actions">
        {review ? (
          <>
            <button type="button" onClick={() => { capture.cancel(); void begin() }}>Retake</button>
            <button type="button" disabled={sending} onClick={() => void submit()}>{sending ? 'Sending' : 'Send'}</button>
          </>
        ) : (
          <button type="button" onClick={() => (recording ? capture.stop() : void begin())}>{recording ? 'Stop' : 'Record'}</button>
        )}
        {!recording && <button type="button" onClick={close}>Close</button>}
      </div>
    </div>
  )
}
