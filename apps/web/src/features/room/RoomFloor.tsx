import { PersonIcon } from '../../components/icons'
import type { RoomView, Seat } from './roomViews'

function Face({ seat, large }: { seat: Seat; large?: boolean }) {
  return (
    <span className={large ? 'room-self-face' : 'room-seat'} data-photo={seat.avatarUrl ? '' : undefined} data-activity={seat.activity ?? undefined}>
      {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
    </span>
  )
}

export function RoomFloor({ view, seats }: { view: RoomView; seats: Seat[] }) {
  if (view === 'you') {
    const me = seats.find((seat) => seat.self)
    const others = seats.filter((seat) => !seat.self)
    return (
      <section className="room-live" data-layout="you" aria-label="You">
        {me && (
          <div className="room-self" data-activity={me.activity ?? undefined}>
            <Face seat={me} large />
            <p className="room-self-name">{me.activity === 'recording' ? 'You · Recording' : 'You'}</p>
          </div>
        )}
        {others.length > 0 && (
          <div className="room-seats" role="list" aria-label="Everyone else">
            {others.map((seat) => (
              <span key={seat.id} role="listitem" className="room-seat-item" aria-label={seat.name}>
                <Face seat={seat} />
              </span>
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="room-live" data-layout="room" aria-label="Room">
      <div className="room-floor">
        {seats.map((seat) => (
          <div key={seat.id} className="room-floor-tile" data-activity={seat.activity ?? undefined}>
            <Face seat={seat} />
            <span className="room-seat-name">{seat.name}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
