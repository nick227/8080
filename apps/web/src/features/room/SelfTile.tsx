import { CameraPreview } from '../CameraPreview'
import { EditPreview } from '../edit/EditPreview'
import { Media } from '../../components/Media'
import { PersonIcon } from '../../components/icons'
import { PersonName } from '../../components/PersonName'
import { VoiceWave } from './VoiceWave'
import type { RecordSession } from './useRecordSession'
import type { Seat } from './roomViews'

function Face({ seat }: { seat: Seat }) {
  return (
    <>
      <span className="room-seat" data-photo={seat.avatarUrl ? '' : undefined} data-activity={seat.activity ?? undefined}>
        {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
      </span>
      <PersonName className="room-seat-name" name={seat.name} tag={seat.tag} />
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

export function SelfTile({ seat, armed, session }: {
  seat: Seat
  armed: boolean
  session: RecordSession | null
}) {
  const feed = armed && session ? <Feed session={session} /> : null
  return (
    <div className={feed ? 'room-cast-face room-self is-live' : 'room-cast-face room-self'} data-recording={feed ? session?.recording || undefined : undefined}>
      {feed ?? <Face seat={seat} />}
      {feed && <PersonName className="room-seat-name" name={seat.name} tag={seat.tag} />}
    </div>
  )
}
