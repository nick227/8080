import { useEffect, useState, type CSSProperties, type ReactNode, type MouseEvent, type KeyboardEvent } from 'react'
import { useMaybeRoomContext, useTracks, VideoTrack } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { PersonIcon } from '../../components/icons'
import { PersonName } from '../../components/PersonName'
import type { Item, SendInput } from '../../api/types'
import { SelfTile } from './SelfTile'
import { RoomAir } from './RoomAir'
import type { PresenceActivity } from './PeopleStrip'
import { tileDensity, VIEW_LABEL, type RoomView, type Seat } from './roomViews'

function FaceTile({ seat }: { seat: Seat }) {
  return (
    <div className="room-cast-face">
      <span className="room-seat" data-photo={seat.avatarUrl ? '' : undefined}>
        {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
      </span>
      <PersonName className="room-seat-name" name={seat.name} tag={seat.tag} />
    </div>
  )
}

// Another person's tile: their live screen or camera when they broadcast (LiveKit
// identity = seat id), otherwise their face. Same tile in Grid and Full.
function SeatTile({ seat }: { seat: Seat }) {
  return useMaybeRoomContext() ? <LiveSeatTile seat={seat} /> : <FaceTile seat={seat} />
}

function LiveSeatTile({ seat }: { seat: Seat }) {
  const tracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera], { onlySubscribed: true })
  const theirs = tracks.filter((ref) => ref.participant.identity === seat.id && !ref.publication.isMuted)
  const shown = theirs.find((ref) => ref.source === Track.Source.ScreenShare) ?? theirs.find((ref) => ref.source === Track.Source.Camera)
  if (!shown) return <FaceTile seat={seat} />
  const screen = shown.source === Track.Source.ScreenShare
  return (
    <div className="room-cast-face is-live" data-live={screen ? 'screen' : 'camera'}>
      <div className="room-seat-media" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <VideoTrack trackRef={shown} style={{ width: '100%', height: '100%', objectFit: screen ? 'contain' : 'cover' }} />
      </div>
      <PersonName className="room-seat-name" name={seat.name} tag={seat.tag} />
    </div>
  )
}

function Floor({ view, seats, item, next, onEnded, onView, self, bar, stack, paused }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  onView: (view: RoomView) => void
  self: () => ReactNode
  bar: ReactNode
  stack?: ReactNode
  paused?: boolean
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const count = Math.max(seats.length, 1)
  const columns = Math.min(3, count)
  const activeId = selected ?? (seats[0] ? `person:${seats[0].id}` : '')
  const fullScreen = view === 'screen'
  const tileInteraction = (id: string, name: string) => {
    if (fullScreen) return {}
    const focus = (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
      if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, audio[controls], video[controls]')) return
      if ('key' in event && !['Enter', ' '].includes(event.key)) return
      event.preventDefault()
      setSelected(id)
      onView('screen')
    }
    return {
      tabIndex: 0,
      'aria-label': `Full screen: ${name}`,
      onClick: focus,
      onKeyDown: focus,
    }
  }

  useEffect(() => {
    if (!item || seats.some((seat) => seat.id === item.author.id)) return
    onEnded()
  }, [item, seats, onEnded])

  const castStyle = { '--columns': columns, '--rows': Math.ceil(count / columns) } as CSSProperties

  return (
    <section className="room-live" data-layout={view} data-density={tileDensity(seats.length)} data-playing={item ? '' : undefined} aria-label={VIEW_LABEL[view]}>
      <div className="room-cast" style={castStyle}>
        {seats.map((seat) => (
          <div className="room-tile" key={seat.id} data-seat={seat.id} {...tileInteraction(`person:${seat.id}`, seat.self ? 'You' : seat.name)} hidden={fullScreen && activeId !== `person:${seat.id}`}>
            {seat.self ? self() : <SeatTile seat={seat} />}
            {item?.author.id === seat.id && (
              <div className="room-tile-air">
                <RoomAir item={item} next={next} onEnded={onEnded} paused={paused} />
              </div>
            )}
          </div>
        ))}
      </div>
      {bar}
      {stack}
    </section>
  )
}

export function RoomFloor({ view, seats, item, next, onEnded, onView }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  onSend: (input: SendInput) => Promise<void>
  onActivity: (activity: PresenceActivity) => void
  onView: (view: RoomView) => void
}) {
  return (
    <Floor
      view={view}
      seats={seats}
      item={item}
      next={next}
      onEnded={onEnded}
      onView={onView}
      self={() => {
        const me = seats.find((seat) => seat.self)
        return me ? <SelfTile seat={me} /> : null
      }}
      bar={null}
    />
  )
}
