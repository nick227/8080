import { useState, type ReactNode } from 'react'
import { useCapture } from '../../state/capture'
import { useUI } from '../../state/ui'
import { PersonIcon } from '../../components/icons'
import type { Item, SendInput } from '../../api/types'
import { SelfTile } from './SelfTile'
import { RoomAir } from './RoomAir'
import { LiveBar } from './LiveBar'
import { RecordStack } from './RecordStack'
import { ViewSwitch } from './ViewSwitch'
import { useRecordSession } from './useRecordSession'
import type { PresenceActivity } from './PeopleStrip'
import { tileDensity, VIEW_LABEL, type RoomView, type Seat } from './roomViews'

function FaceTile({ seat, dominant, active, onPick }: {
  seat: Seat
  dominant?: boolean
  active?: boolean
  onPick?: () => void
}) {
  const className = dominant ? 'room-cast-face is-dominant' : 'room-cast-face'
  const body = (
    <>
      <span className="room-seat" data-photo={seat.avatarUrl ? '' : undefined} data-active={active || undefined}>
        {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
      </span>
      <span className="room-seat-name">{seat.name}</span>
    </>
  )
  if (!onPick) return <div className={className}>{body}</div>
  return <button type="button" className={className} aria-label={seat.name} onClick={onPick}>{body}</button>
}

function InviteButton({ inviteUrl }: { inviteUrl?: string }) {
  const [copied, setCopied] = useState(false)
  if (!inviteUrl) return null
  const copy = async () => {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <button type="button" className="room-bar-invite" aria-label={copied ? 'Invite link copied' : 'Copy invite link'} onClick={() => void copy()}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        {copied
          ? <path d="M3.5 8.2 6.4 11 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          : <path d="M8 3.25v9.5M3.25 8h9.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />}
      </svg>
    </button>
  )
}

function Floor({ view, seats, item, next, onEnded, onView, self, bar, stack }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  onView: (view: RoomView) => void
  self: (dominant: boolean) => ReactNode
  bar: ReactNode
  stack?: ReactNode
}) {
  const [focusId, setFocusId] = useState<string | null>(null)
  const me = seats.find((seat) => seat.self)
  const focus = seats.find((seat) => seat.id === focusId) ?? me ?? seats[0]
  const selfLarge = view === 'person' && focus?.id === me?.id
  const showAir = view === 'stage' || view === 'focus' || (view === 'gallery' && !!item)
  const pick = (id: string) => {
    setFocusId(id)
    if (view !== 'person') onView('person')
  }
  const step = (dir: number) => {
    if (!focus || seats.length < 2) return
    const index = seats.findIndex((seat) => seat.id === focus.id)
    setFocusId(seats[(index + dir + seats.length) % seats.length].id)
  }

  return (
    <section className="room-live" data-layout={view} data-density={tileDensity(seats.length)} data-playing={item ? '' : undefined} aria-label={VIEW_LABEL[view]}>
      <div className="room-cast">
        {me && !selfLarge && self(false)}
        {seats.filter((seat) => !seat.self && !(view === 'person' && seat.id === focus?.id)).map((seat) => (
          <FaceTile key={seat.id} seat={seat} active={view === 'focus' && item?.author.id === seat.id} onPick={() => pick(seat.id)} />
        ))}
      </div>
      {view === 'person' && focus && (
        <div className="room-dominant">
          {selfLarge && me ? self(true) : <FaceTile seat={focus} dominant />}
          {seats.length > 1 && !stack && (
            <div className="room-person-nav">
              <button type="button" aria-label="Previous person" onClick={() => step(-1)}>‹</button>
              <button type="button" aria-label="Next person" onClick={() => step(1)}>›</button>
            </div>
          )}
        </div>
      )}
      {showAir && <RoomAir item={item} next={next} onEnded={onEnded} />}
      {bar}
      {stack}
    </section>
  )
}

export function RoomFloor({ view, seats, item, next, onEnded, onSend, onActivity, onView, inviteUrl, deskOpen }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  onSend: (input: SendInput) => Promise<void>
  onActivity: (activity: PresenceActivity) => void
  onView: (view: RoomView) => void
  inviteUrl?: string
  deskOpen?: boolean
}) {
  const invite = <InviteButton inviteUrl={inviteUrl} />
  const shared = { view, seats, item, next, onEnded, onView }
  if (deskOpen) {
    return (
      <Floor
        {...shared}
        self={(dominant) => {
          const me = seats.find((seat) => seat.self)
          return me ? <FaceTile seat={me} dominant={dominant} /> : null
        }}
        bar={<div className="room-bar">{invite}<ViewSwitch value={view} onChange={onView} /></div>}
      />
    )
  }
  return <ArmedFloor {...shared} onSend={onSend} onActivity={onActivity} invite={invite} />
}

function ArmedFloor({ view, seats, item, next, onEnded, onSend, onActivity, onView, invite }: {
  view: RoomView
  seats: Seat[]
  item?: Item
  next: Item[]
  onEnded: () => void
  onSend: (input: SendInput) => Promise<void>
  onActivity: (activity: PresenceActivity) => void
  onView: (view: RoomView) => void
  invite: ReactNode
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
      self={(dominant) => {
        const me = seats.find((seat) => seat.self)
        return me ? <SelfTile seat={me} dominant={dominant} armed={armed} session={session} onGoLive={armCamera} /> : null
      }}
      bar={<LiveBar session={session} armed={armed} setArmed={setArmed} invite={invite} view={view} onView={onView} />}
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
