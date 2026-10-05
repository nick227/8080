import { useEffect, useState, type CSSProperties, type ReactNode, type MouseEvent, type KeyboardEvent } from 'react'
import { useCapture } from '../../state/capture'
import { useUI } from '../../state/ui'
import { PersonIcon } from '../../components/icons'
import { PersonName } from '../../components/PersonName'
import type { Item, SendInput } from '../../api/types'
import { Control } from '../../components/Control'
import { SelfTile } from './SelfTile'
import { RoomAir } from './RoomAir'
import { LiveBar } from './LiveBar'
import { RecordStack } from './RecordStack'
import { useRecordSession } from './useRecordSession'
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
          <div className="room-tile" key={seat.id} {...tileInteraction(`person:${seat.id}`, seat.self ? 'You' : seat.name)} hidden={fullScreen && activeId !== `person:${seat.id}`}>
            {seat.self ? self() : <FaceTile seat={seat} />}
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

export function RoomFloor({ view, seats, item, next, onEnded, onSend, onActivity, onView, onPost, deskOpen }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  onSend: (input: SendInput) => Promise<void>
  onActivity: (activity: PresenceActivity) => void
  onView: (view: RoomView) => void
  onPost: () => void
  deskOpen?: boolean
}) {
  const shared = { view, seats, item, next, onEnded, onView, paused: deskOpen }
  if (deskOpen) {
    return (
      <Floor
        {...shared}
        self={() => {
          const me = seats.find((seat) => seat.self)
          return me ? <FaceTile seat={me} /> : null
        }}
        bar={<div className="room-bar"><PostControl onPost={onPost} /></div>}
      />
    )
  }
  return <ArmedFloor {...shared} onSend={onSend} onActivity={onActivity} onPost={onPost} />
}

function PostControl({ onPost }: { onPost: () => void }) {
  return <Control variant="default" className="sub-control" type="button" aria-label="Post" onClick={onPost}>Aa</Control>
}

function ArmedFloor({ view, seats, item, next, onEnded, onSend, onActivity, onView, onPost }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  onSend: (input: SendInput) => Promise<void>
  onActivity: (activity: PresenceActivity) => void
  onView: (view: RoomView) => void
  onPost: () => void
}) {
  const [armed, setArmed] = useState(false)
  const session = useRecordSession({ onSend, onActivity, onClose: () => setArmed(false) })
  const submit = async () => {
    if (!session.canSend || session.sending) return
    await session.send()
    if (useUI.getState().error) return
    useCapture.getState().complete()
    setArmed(false)
  }
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
        return me ? <SelfTile seat={me} armed={armed} session={session} /> : null
      }}
      bar={<LiveBar session={session} armed={armed} setArmed={setArmed} onPost={onPost} />}
      stack={armed ? (
        <RecordStack
          session={session}
          onCancel={() => session.back()}
          onRetry={() => { session.discard(); void session.begin() }}
          onSubmit={() => void submit()}
        />
      ) : null}
    />
  )
}
