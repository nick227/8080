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

// The desk's capture cluster, floated over a live tile. Framing shows the
// background and device with the round record button. A take leaves only Stop.
// Review is Cancel, Play, RETRY, and Send on that same button.
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
      {framing && <DevicePicker />}
      {review && (
        <div className="room-desk-actions">
          <button type="button" className="room-desk-cancel" onClick={onCancel}>Cancel</button>
          {session.showPlay && (
            <button type="button" onClick={session.togglePlay}>{session.playing ? 'Pause' : 'Play'}</button>
          )}
          {session.showRetry && <button type="button" onClick={onRetry}>RETRY</button>}
        </div>
      )}
      <RecordButton
        session={session}
        label={label}
        onRecord={() => void session.begin()}
        onStop={() => session.capture.stop()}
        onSubmit={onSubmit}
      />
    </div>
  )
}
