import { useState, type ReactNode } from 'react'
import { useCapture } from '../../state/capture'
import { useUI } from '../../state/ui'
import { PersonIcon } from '../../components/icons'
import type { Item, SendInput } from '../../api/types'
import { Control } from '../../components/Control'
import { SelfTile } from './SelfTile'
import { RoomAir } from './RoomAir'
import { LiveBar } from './LiveBar'
import { RecordStack } from './RecordStack'
import { ViewSwitch } from './ViewSwitch'
import { useRecordSession } from './useRecordSession'
import type { PresenceActivity } from './PeopleStrip'
import { tileDensity, VIEW_LABEL, type RoomView, type Seat } from './roomViews'

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

function Floor({ view, seats, item, next, onEnded, onView, self, bar, stack }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  onView: (view: RoomView) => void
  self: () => ReactNode
  bar: ReactNode
  stack?: ReactNode
}) {
  const me = seats.find((seat) => seat.self)
  const showAir = view === 'screen' || !!item

  return (
    <section className="room-live" data-layout={view} data-density={tileDensity(seats.length)} data-playing={item ? '' : undefined} aria-label={VIEW_LABEL[view]}>
      <div className="room-cast">
        {me && self()}
        {seats.filter((seat) => !seat.self).map((seat) => (
          <FaceTile key={seat.id} seat={seat} />
        ))}
      </div>
      {showAir && <RoomAir item={item} next={next} onEnded={onEnded} />}
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
  const shared = { view, seats, item, next, onEnded, onView }
  if (deskOpen) {
    return (
      <Floor
        {...shared}
        self={() => {
          const me = seats.find((seat) => seat.self)
          return me ? <FaceTile seat={me} /> : null
        }}
        bar={<div className="room-bar"><PostControl onPost={onPost} /><ViewSwitch value={view} onChange={onView} /></div>}
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
  const armCamera = () => {
    if (session.recording) return
    session.chooseFrame('camera')
    setArmed(true)
  }
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
        return me ? <SelfTile seat={me} armed={armed} session={session} onGoLive={armCamera} /> : null
      }}
      bar={<LiveBar session={session} armed={armed} setArmed={setArmed} onPost={onPost} view={view} onView={onView} />}
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
