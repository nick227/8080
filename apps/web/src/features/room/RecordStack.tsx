import { Control } from '../../components/Control'
import { DevicePicker } from '../DevicePicker'
import { BackgroundStrip } from './BackgroundStrip'
import type { RecordSession } from './useRecordSession'

export function RecordButton({ session, label, onRecord, onStop, onSubmit }: {
  session: Pick<RecordSession, 'action' | 'bgBlocking' | 'sending' | 'edit' | 'canSend'>
  label: string
  onRecord: () => void
  onStop: () => void
  onSubmit: () => void
}) {
  const { action, bgBlocking, sending, edit, canSend } = session
  return (
    <Control
      variant="record"
      type="button"
      disabled={(action === 'record' && bgBlocking) || (action === 'submit' && (sending || edit.fitting || !canSend))}
      active={action === 'stop'}
      data-mass={action === 'stop' ? 'dense' : action === 'submit' ? 'present' : 'rest'}
      data-action={action}
      aria-label={action === 'stop' ? 'Stop' : action === 'record' ? 'Record' : label}
      onClick={() => (action === 'stop' ? onStop() : action === 'record' ? onRecord() : onSubmit())}
    >
      <span className="room-desk-verb">
        {action === 'stop' ? '◉' : action === 'record' ? '●' : label}
      </span>
    </Control>
  )
}

// Same vertical order as the desk: background, the round button, then the
// device, then Cancel. Review adds Play and RETRY beside it. A take leaves only Stop.
export function RecordStack({ session, onCancel, onRetry, onSubmit }: {
  session: RecordSession
  onCancel: () => void
  onRetry: () => void
  onSubmit: () => void
}) {
  const framing = !session.recording && !session.showTake
  const review = session.showTake && !session.recording
  const label = session.rendering ? 'Rendering' : session.sending ? 'Sending' : 'Send'
  return (
    <div className="room-record" data-phase={session.recording ? 'recording' : review ? 'review' : 'framing'}>
      {framing && session.showCamera && <BackgroundStrip />}
      <RecordButton
        session={session}
        label={label}
        onRecord={() => void session.begin()}
        onStop={() => session.capture.stop()}
        onSubmit={onSubmit}
      />
      {framing && <DevicePicker />}
      {!session.recording && (
        <div className="room-desk-actions">
          <button type="button" className="room-desk-cancel" onClick={onCancel}>Cancel</button>
          {review && session.showPlay && (
            <button type="button" onClick={session.togglePlay}>{session.playing ? 'Pause' : 'Play'}</button>
          )}
          {review && session.showRetry && <button type="button" onClick={onRetry}>RETRY</button>}
        </div>
      )}
    </div>
  )
}
