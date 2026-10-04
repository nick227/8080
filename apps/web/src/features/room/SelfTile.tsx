import { CameraPreview } from '../CameraPreview'
import { EditPreview } from '../edit/EditPreview'
import { Media } from '../../components/Media'
import { PersonIcon } from '../../components/icons'
import { VoiceWave } from './VoiceWave'
import type { RecordSession } from './useRecordSession'
import type { Seat } from './roomViews'

function Face({ seat }: { seat: Seat }) {
  return (
    <>
      <span className="room-seat" data-photo={seat.avatarUrl ? '' : undefined} data-activity={seat.activity ?? undefined}>
        {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
      </span>
      <span className="room-seat-name">{seat.name}</span>
    </>
  )
}

function Feed({ session }: { session: RecordSession }) {
  const audioDeviceId = session.choice.kind === 'audioinput' ? session.choice.deviceId : ''
  if (session.showCamera) return <CameraPreview deviceId={session.videoDeviceId} recording={session.recording} />
  if (session.showWave) return <VoiceWave deviceId={audioDeviceId} recording={session.recording} />
  if (!session.showTake || !session.previewSrc || !session.held || session.held.kind === 'text') return null
  const held = session.held
  return (
    <div ref={session.stageRef} className="room-seat-media">
      {session.edit.fitted?.buffer ? (
        <EditPreview
          key={session.edit.fitted.trackId}
          kind={held.kind}
          url={held.url}
          imageUrl={session.edit.fitted.imageUrl}
          buffer={session.edit.fitted.buffer}
          durationMs={session.edit.fitted.durationMs}
          waveform={held.kind === 'audio' ? session.edit.fitted.waveform : undefined}
          onPlaying={session.setPlaying}
        />
      ) : (
        <Media
          type={session.previewType === 'image' ? 'image' : session.previewType}
          src={session.previewSrc}
          name="take"
          waveform={session.previewType === 'audio' ? session.waveform ?? undefined : undefined}
          hidePlayButton
          isActive={false}
          onPlayStatusChange={session.setPlaying}
        />
      )}
    </div>
  )
}

export function SelfTile({ seat, dominant, armed, session, onGoLive }: {
  seat: Seat
  dominant?: boolean
  armed: boolean
  session: RecordSession | null
  onGoLive: () => void
}) {
  const className = dominant ? 'room-cast-face room-self is-dominant' : 'room-cast-face room-self'
  const feed = armed && session ? <Feed session={session} /> : null
  if (!feed) {
    return (
      <button type="button" className={className} aria-label={`${seat.name}, go live`} onClick={onGoLive}>
        <Face seat={seat} />
      </button>
    )
  }
  return (
    <div className={`${className} is-live`} data-recording={session?.recording || undefined}>
      {feed}
      <span className="room-seat-name">{seat.name}</span>
    </div>
  )
}
