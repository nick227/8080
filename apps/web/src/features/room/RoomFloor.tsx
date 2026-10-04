import { PersonIcon } from '../../components/icons'
import type { Item, SendInput } from '../../api/types'
import { LiveTile } from './LiveTile'
import { RoomAir } from './RoomAir'
import type { PresenceActivity } from './PeopleStrip'
import type { RoomView, Seat } from './roomViews'

function FaceTile({ seat }: { seat: Seat }) {
  return (
    <div className="room-cast-face">
      <span className="room-seat" data-photo={seat.avatarUrl ? '' : undefined}>
        {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
      </span>
      <span className="room-seat-name">{seat.name}</span>
    </div>
  )
}

export function RoomFloor({ view, seats, item, next, onEnded, onSend, onActivity, onView }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  onSend: (input: SendInput) => Promise<void>
  onActivity: (activity: PresenceActivity) => void
  onView: (view: RoomView) => void
}) {
  const me = seats.find((seat) => seat.self)
  const others = seats.filter((seat) => !seat.self)
  const selfLarge = view === 'you'

  return (
    <section className="room-live" data-layout={view} aria-label={selfLarge ? 'You' : 'Room'}>
      <div className="room-cast" data-size={selfLarge ? 'self' : 'medium'}>
        {me && <LiveTile seat={me} onSend={onSend} onActivity={onActivity} />}
        {others.map((seat) => <FaceTile key={seat.id} seat={seat} />)}
      </div>
      <RoomAir item={item} next={next} onEnded={onEnded} view={view} onView={onView} />
    </section>
  )
}
