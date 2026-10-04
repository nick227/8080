import { PersonIcon } from '../../components/icons'
import type { Item } from '../../api/types'
import { RoomStage } from './RoomStage'
import { latestBy, type RoomView, type Seat } from './roomViews'

function Mark({ seat, size }: { seat: Seat; size: 'small' | 'medium' }) {
  return (
    <span className={`room-seat is-${size}`} data-photo={seat.avatarUrl ? '' : undefined} data-activity={seat.activity ?? undefined}>
      {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
    </span>
  )
}

function SeatRow({ seats, size, activeId, onPick }: {
  seats: Seat[]
  size: 'small' | 'medium'
  activeId?: string
  onPick?: (id: string) => void
}) {
  return (
    <div className="room-seats" data-size={size} role="list" aria-label="People">
      {seats.map((seat) => {
        const body = (
          <>
            <Mark seat={seat} size={size} />
            {size === 'medium' && <span className="room-seat-name">{seat.name}</span>}
          </>
        )
        if (!onPick) {
          return <span key={seat.id} role="listitem" className="room-seat-item" aria-label={seat.name}>{body}</span>
        }
        return (
          <button key={seat.id} type="button" className="room-seat-item" aria-pressed={seat.id === activeId} aria-label={seat.name} onClick={() => onPick(seat.id)}>
            {body}
          </button>
        )
      })}
    </div>
  )
}

function Self({ seat }: { seat?: Seat }) {
  if (!seat) return null
  return (
    <div className="room-self" data-activity={seat.activity ?? undefined}>
      <span className="room-self-face" data-photo={seat.avatarUrl ? '' : undefined}>
        {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
      </span>
      <p className="room-self-name">{seat.activity === 'recording' ? 'You · Recording' : seat.name}</p>
    </div>
  )
}

export function RoomFloor({ view, item, items, seats, speakerId, onOpen, onPick }: {
  view: RoomView
  item?: Item
  items: Item[]
  seats: Seat[]
  speakerId?: string
  onOpen?: (id: string) => void
  onPick: (id: string) => void
}) {
  const open = item && onOpen ? () => onOpen(item.id) : undefined
  const me = seats.find((seat) => seat.self)
  const featuredId = speakerId && seats.some((seat) => seat.id === speakerId) ? speakerId : item?.author.id
  const featured = latestBy(items, featuredId) ?? item

  if (view === 'log') {
    return (
      <section className="room-live" data-layout="log" aria-label="People">
        <SeatRow seats={seats} size="small" />
      </section>
    )
  }

  if (view === 'gallery') {
    return (
      <section className="room-live" data-layout="gallery" aria-label="Gallery">
        <div className="room-gallery">
          {seats.map((seat) => (
            <button
              key={seat.id}
              type="button"
              className="room-tile"
              data-on={seat.id === item?.author.id ? '' : undefined}
              data-activity={seat.activity ?? undefined}
              aria-label={seat.name}
              onClick={() => { if (seat.itemId) onOpen?.(seat.itemId) }}
            >
              {seat.still ? <img src={seat.still} alt="" /> : (
                <span className="room-tile-face" data-photo={seat.avatarUrl ? '' : undefined}>
                  {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
                </span>
              )}
              <span className="room-tile-name">{seat.name}</span>
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (view === 'you') {
    return (
      <section className="room-live" data-layout="you" aria-label="You">
        <Self seat={me} />
        <div className="room-inset">
          <RoomStage item={item} onOpen={open} />
        </div>
        <SeatRow seats={seats.filter((seat) => !seat.self)} size="small" />
      </section>
    )
  }

  if (view === 'speaker') {
    return (
      <section className="room-live" data-layout="speaker" aria-label="Speaker">
        <SeatRow seats={seats} size="small" activeId={featuredId} onPick={onPick} />
        <div className="room-stage-slot">
          <RoomStage item={featured} onOpen={featured && onOpen ? () => onOpen(featured.id) : undefined} />
        </div>
      </section>
    )
  }

  return (
    <section className="room-live" data-layout="stage" aria-label="Stage">
      <div className="room-stage-slot">
        <RoomStage item={item} onOpen={open} />
      </div>
      <SeatRow seats={seats} size="medium" />
    </section>
  )
}
