import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useMaybeRoomContext, useTracks, VideoTrack } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { GridViewIcon, MaximizeIcon, PersonIcon } from '../../components/icons'
import { PersonName } from '../../components/PersonName'
import type { Item, SendInput } from '../../api/types'
import { SelfTile } from './SelfTile'
import { ChannelButton } from './hostChannel'
import { RoomAir } from './RoomAir'
import { TeamInviteDialog } from './TeamInviteDialog'
import { SectionHeader } from '../work/SectionHeader'
import type { PresenceActivity } from './PeopleStrip'
import '../documents/DocumentsList.css'
import { tileDensity, VIEW_LABEL, type RoomView, type Seat } from './roomViews'

function FaceTile({ seat, thumbnail = false, children }: { seat: Seat; thumbnail?: boolean; children?: ReactNode }) {
  return (
    <div className="room-cast-face">
      <span className="room-seat" data-photo={seat.avatarUrl ? '' : undefined}>
        {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
      </span>
      <PersonName className="room-seat-name" name={seat.name} tag={seat.tag} />
      {!thumbnail && <ChannelButton seatId={seat.id} />}
      {children}
    </div>
  )
}

// Another person's tile: their live screen or camera when they broadcast (LiveKit
// identity = seat id), otherwise their face. Same tile in Grid and Full.
function SeatTile({ seat, thumbnail = false, children }: { seat: Seat; thumbnail?: boolean; children?: ReactNode }) {
  return useMaybeRoomContext()
    ? <LiveSeatTile seat={seat} thumbnail={thumbnail}>{children}</LiveSeatTile>
    : <FaceTile seat={seat} thumbnail={thumbnail}>{children}</FaceTile>
}

function LiveSeatTile({ seat, thumbnail = false, children }: { seat: Seat; thumbnail?: boolean; children?: ReactNode }) {
  const tracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera], { onlySubscribed: true })
  const theirs = tracks.filter((ref) => ref.participant.identity === seat.id && !ref.publication.isMuted)
  const shown = theirs.find((ref) => ref.source === Track.Source.ScreenShare) ?? theirs.find((ref) => ref.source === Track.Source.Camera)
  if (!shown) return <FaceTile seat={seat} thumbnail={thumbnail}>{children}</FaceTile>
  const screen = shown.source === Track.Source.ScreenShare
  return (
    <div className="room-cast-face is-live" data-live={screen ? 'screen' : 'camera'}>
      <div className="room-seat-media" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <VideoTrack trackRef={shown} style={{ width: '100%', height: '100%', objectFit: screen ? 'contain' : 'cover' }} />
      </div>
      <PersonName className="room-seat-name" name={seat.name} tag={seat.tag} />
      {children}
    </div>
  )
}

function Floor({ view, seats, item, next, onEnded, self, bar, stack, paused }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  self: (chrome?: ReactNode) => ReactNode
  bar: ReactNode
  stack?: ReactNode
  paused?: boolean
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const count = Math.max(seats.length, 1)
  const columns = Math.min(3, count)
  const activeId = seats.some((seat) => `person:${seat.id}` === selected)
    ? selected
    : (seats[0] ? `person:${seats[0].id}` : '')
  const fullScreen = selected !== null
  useEffect(() => { setSelected(null) }, [view])
  useEffect(() => {
    if (!fullScreen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setSelected(null)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [fullScreen])
  const thumbnails = fullScreen ? seats.filter((seat) => `person:${seat.id}` !== activeId) : []

  useEffect(() => {
    if (!item || seats.some((seat) => seat.id === item.author.id)) return
    onEnded()
  }, [item, seats, onEnded])

  const castStyle = { '--columns': columns, '--rows': Math.ceil(count / columns) } as CSSProperties

  return (
    <section className="room-live" data-layout={fullScreen ? 'screen' : view} data-density={tileDensity(seats.length)} data-thumbnails={fullScreen && thumbnails.length > 0 ? '' : undefined} data-playing={item ? '' : undefined} aria-label={VIEW_LABEL[view]}>
      {fullScreen && thumbnails.length > 0 && (
        <div className="room-thumbnails" role="group" aria-label="Team view switcher">
          {thumbnails.map((seat) => (
            <button
              key={seat.id}
              type="button"
              className="room-thumbnail"
              aria-label={`Full screen: ${seat.self ? 'You' : seat.name}`}
              onClick={() => setSelected(`person:${seat.id}`)}
            >
              <SeatTile seat={seat} thumbnail />
            </button>
          ))}
        </div>
      )}
      {view === 'table' && !fullScreen && <div className="team-table-view">
        <SectionHeader title="Team" level={1} newLabel="user" onNew={() => setInviting(true)} />
        <div className="docs-table-wrap team-table-scroll"><table className="docs-table team-table">
          <caption className="record-sr-only">Team members. Open a member to view full screen.</caption>
          <thead><tr><th scope="col">Member</th><th scope="col">Presence</th><th scope="col">Activity</th><th scope="col">Member view</th></tr></thead>
          <tbody>{seats.map(seat => <tr key={seat.id} onClick={() => setSelected(`person:${seat.id}`)}>
            <td><button type="button" className="team-member-link" onClick={() => setSelected(`person:${seat.id}`)}>
              {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
              <PersonName name={seat.name} tag={seat.tag} />{seat.self && <small>You</small>}
            </button></td>
            <td>Here</td><td>{seat.activity === 'typing' ? 'Typing' : seat.activity === 'recording' ? 'Recording' : '—'}</td>
            <td><button type="button" className="team-member-link" aria-label={`Open ${seat.name}`} onClick={() => setSelected(`person:${seat.id}`)}><MaximizeIcon /></button></td>
          </tr>)}</tbody>
        </table></div>
        {!seats.length && <p>No members are present.</p>}
      </div>}
      <div className="room-cast" style={castStyle} hidden={view === 'table' && !fullScreen}>
        {seats.map((seat) => {
          const id = `person:${seat.id}`
          const name = seat.self ? 'You' : seat.name
          const shown = !fullScreen || activeId === id
          const chrome = shown ? (
            <>
              {item?.author.id === seat.id && (
                <div className="room-tile-air">
                  <RoomAir item={item} next={next} onEnded={onEnded} paused={paused} />
                </div>
              )}
              <button
                type="button"
                className="room-tile-view"
                aria-label={fullScreen ? `Back to ${VIEW_LABEL[view]}` : `Full screen: ${name}`}
                onClick={() => {
                  if (fullScreen) {
                    setSelected(null)
                    return
                  }
                  setSelected(id)

                }}
              >
                {fullScreen ? <GridViewIcon /> : <MaximizeIcon />}
              </button>
            </>
          ) : null
          return (
            <div className="room-tile" key={seat.id} data-seat={seat.id} hidden={!shown}>
              {seat.self ? self(chrome) : <SeatTile seat={seat}>{chrome}</SeatTile>}
            </div>
          )
        })}
      </div>
      {view === 'grid' && !fullScreen && <button type="button" className="team-streaming-add" onClick={() => setInviting(true)}>+ Add user</button>}
      {inviting && <TeamInviteDialog inviteUrl={`${window.location.origin}${window.location.pathname}`} onClose={() => setInviting(false)} />}
      {bar}
      {stack}
    </section>
  )
}

export function RoomFloor({ view, seats, item, next, onEnded }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  onSend: (input: SendInput) => Promise<void>
  onActivity: (activity: PresenceActivity) => void
}) {
  return (
    <Floor
      view={view}
      seats={seats}
      item={item}
      next={next}
      onEnded={onEnded}
      self={(chrome) => {
        const me = seats.find((seat) => seat.self)
        return me ? <SelfTile seat={me}>{chrome}</SelfTile> : null
      }}
      bar={null}
    />
  )
}
