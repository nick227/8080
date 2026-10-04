import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent, type KeyboardEvent } from 'react'
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
      <PersonName className="room-seat-name" name={seat.name} tag={seat.tag} />
    </div>
  )
}

function messageOnly(item?: Item) {
  return !!item && !item.media?.some((media) => (media.type === 'video' || media.type === 'audio' || media.type === 'image') && !!media.url)
}

function Floor({ view, seats, item, next, onEnded, onView, self, bar, stack, paused }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  onView: (view: RoomView) => void
  self: () => ReactNode
  bar: (viewSwitch: ReactNode) => ReactNode
  stack?: ReactNode
  paused?: boolean
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const castRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(1)
  const targets = [...seats.map((seat) => ({ id: `person:${seat.id}`, name: seat.self ? 'You' : seat.name })), { id: 'stage', name: 'Stage' }]
  const active = targets.find((target) => target.id === selected) ?? targets[0]
  const fullScreen = view === 'screen'
  const stageFocused = fullScreen && active.id === 'stage'
  const nextTarget = fullScreen ? targets[targets.findIndex((target) => target.id === active.id) + 1] : targets[0]
  const cycleView = () => {
    if (nextTarget) {
      setSelected(nextTarget.id)
      onView('screen')
    } else {
      setSelected(null)
      onView('grid')
    }
  }
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
    const cast = castRef.current
    if (!cast) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const count = Math.max(seats.length, 1)
      let bestColumns = 1
      let bestWidth = 0
      for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols)
        const tileWidth = Math.min((width - (cols - 1) * 8) / cols, (height - (rows - 1) * 8) / rows * 16 / 9)
        if (tileWidth > bestWidth) {
          bestWidth = tileWidth
          bestColumns = cols
        }
      }
      setColumns(bestColumns)
    })
    observer.observe(cast)
    return () => observer.disconnect()
  }, [seats.length])

  const castStyle = { '--columns': columns, '--rows': Math.ceil(Math.max(seats.length, 1) / columns) } as CSSProperties

  return (
    <section className="room-live" data-layout={view} data-density={tileDensity(seats.length)} data-stage={stageFocused || undefined} data-playing={item ? '' : undefined} data-broadcast={messageOnly(item) ? 'message' : undefined} aria-label={VIEW_LABEL[view]}>
      <div ref={castRef} className="room-cast" style={castStyle} hidden={stageFocused}>
        {seats.map((seat) => (
          <div className="room-tile" key={seat.id} {...tileInteraction(`person:${seat.id}`, seat.self ? 'You' : seat.name)} hidden={fullScreen && active.id !== `person:${seat.id}`}>
            {seat.self ? self() : <FaceTile seat={seat} />}
          </div>
        ))}
      </div>
      <div className="room-floor-stage" {...tileInteraction('stage', 'Stage')} hidden={fullScreen && !stageFocused}>
        <RoomAir item={item} next={next} onEnded={onEnded} paused={paused} />
        {!item && <p className="room-stage-empty">The stage is clear</p>}
      </div>
      {bar(<ViewSwitch value={view} onCycle={cycleView} nextLabel={nextTarget ? `Full screen: ${nextTarget.name}` : 'Grid'} />)}
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
        bar={(viewSwitch) => <div className="room-bar"><PostControl onPost={onPost} />{viewSwitch}</div>}
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
      bar={(viewSwitch) => <LiveBar session={session} armed={armed} setArmed={setArmed} onPost={onPost} viewSwitch={viewSwitch} />}
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
