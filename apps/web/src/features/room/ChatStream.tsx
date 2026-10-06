import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { Media, MediaType } from '../../api/types'
import { Media as MediaView } from '../../components/Media'
import { PersonName } from '../../components/PersonName'
import { controllerWithin } from '../../media/controller'
import { countAfter, groupTurns } from './groupTurns'
import { ChoiceBar, type ChoiceView } from './ChoiceBar'
import { ProposalCard, type ProposalView } from './ProposalCard'
import './proposal.css'
import './choices.css'
import './host.css'

export type StreamMedia = {
  type: MediaType
  url: string
  poster?: string
  title?: string
  name?: string
  embeddable?: boolean
}

export type StreamRow = {
  id: string
  authorId?: string
  author: string
  tag?: string
  avatarUrl?: string
  postedAt?: string
  text?: string
  media: StreamMedia[]
  choice?: ChoiceView
  proposal?: ProposalView
  links?: { id: string; title: string; onOpen: () => void }[]
  status?: 'sending' | 'failed'
  onReply?: () => void
  onRetry?: () => void
  onDelete?: () => void
}

const mark = (name: string) => (name.trim().charAt(0) || '?').toUpperCase()
const NEAR_BOTTOM = 64

function quietTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

function exactTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

function When({ iso }: { iso?: string }) {
  const [exact, setExact] = useState(false)
  if (!iso || !quietTime(iso)) return null
  return (
    <button type="button" className="room-when" aria-pressed={exact} onClick={() => setExact((on) => !on)}>
      <time dateTime={iso}>{exact ? exactTime(iso) : quietTime(iso)}</time>
    </button>
  )
}

function Piece({ row, media, onPlaying }: { row: StreamRow; media: StreamMedia; onPlaying: (playing: boolean) => void }) {
  const audio = media.type === 'audio'
  return (
    <div className="room-media" data-kind={media.type}>
      <MediaView
        type={media.type}
        src={media.url}
        poster={media.poster}
        name={media.name ?? media.title}
        title={media.title}
        embeddable={media.embeddable}
        hidePlayButton={audio}
        onPlayStatusChange={audio ? onPlaying : undefined}
        isActive={false}
      />
    </div>
  )
}

function DeleteLink({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false)
  return (
    <button type="button" data-armed={armed || undefined} onClick={() => { if (!armed) { setArmed(true); return } onDelete() }}>
      {armed ? 'Confirm' : 'Delete'}
    </button>
  )
}

const Entry = memo(function Entry({ row }: { row: StreamRow }) {
  const ref = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const audio = row.media.some((media) => media.type === 'audio')
  const toggle = () => {
    const ctrl = controllerWithin(ref.current)
    if (!ctrl) return
    if (playing) ctrl.pause()
    else void ctrl.play()
  }
  return (
    <div ref={ref} className="room-entry" data-item-id={row.id}>
      {row.text && !row.proposal && <p className="room-text">{row.text}</p>}
      {row.proposal && <ProposalCard {...row.proposal} />}
      {row.media.map((media, index) => (
        <Piece key={`${row.id}-${index}`} row={row} media={media} onPlaying={setPlaying} />
      ))}
      {row.links && (
        <div className="room-links">
          {row.links.map((link) => (
            <button key={link.id} type="button" className="room-link" onClick={link.onOpen}>
              <span className="room-link-kind">Document</span>
              <span className="room-link-title">{link.title}</span>
            </button>
          ))}
        </div>
      )}
      {row.choice && <ChoiceBar {...row.choice} />}
      <div className="room-actions">
        {row.status === 'sending' && <span className="room-status">Sending</span>}
        {row.status === 'failed' && (
          <button type="button" className="room-status" onClick={row.onRetry}>Didn't send — retry</button>
        )}
        {audio && <button type="button" onClick={toggle} aria-pressed={playing}>{playing ? 'Pause' : 'Play'}</button>}
        {row.onReply && <button type="button" onClick={row.onReply}>Reply</button>}
        {row.onDelete && <DeleteLink onDelete={row.onDelete} />}
      </div>
    </div>
  )
})

export function ChatStream({ rows, pin, anchorId, onCaughtUp, hasOlder, loadingOlder, onLoadOlder }: {
  rows: StreamRow[]
  pin: number
  anchorId?: string
  onCaughtUp?: () => void
  hasOlder?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(!anchorId)
  const sticking = useRef(false)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const seenId = useRef(rows.at(-1)?.id)
  const pinSeen = useRef(pin)
  const opened = useRef(false)
  const caughtUp = useRef(onCaughtUp)
  caughtUp.current = onCaughtUp
  const [fresh, setFresh] = useState(0)
  const tail = `${rows.length}:${rows.at(-1)?.id ?? ''}`
  const turns = groupTurns(rows, anchorId)
  const previousHead = useRef<{ id: string; offset: number } | undefined>(undefined)

  // Keep the existing first row in place when an older page is prepended.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const entries = Array.from(el.querySelectorAll<HTMLElement>('[data-item-id]'))
    const offset = (node: HTMLElement) => node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
    const previous = previousHead.current
    if (previous && rows[0]?.id !== previous.id) {
      const node = entries.find((entry) => entry.dataset.itemId === previous.id)
      if (node) {
        nearBottom.current = false
        el.scrollTop += offset(node) - previous.offset
      }
    }
    const head = entries[0]
    previousHead.current = head ? { id: head.dataset.itemId!, offset: offset(head) } : undefined
  }, [rows])

  const settle = (bottom: boolean) => {
    nearBottom.current = bottom
    if (!bottom) return
    seenId.current = rows.at(-1)?.id
    setFresh(0)
    caughtUp.current?.()
  }

  const onScroll = () => {
    const el = scroller.current
    if (!el || sticking.current) return
    settle(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM)
  }

  useLayoutEffect(() => {
    if (pinSeen.current === pin) return
    pinSeen.current = pin
    nearBottom.current = true
  }, [pin])

  useLayoutEffect(() => {
    if (opened.current) return
    opened.current = true
    const el = scroller.current
    if (!el) return
    if (!anchorId) return
    const node = el.querySelector('[data-unread]')
    if (node instanceof HTMLElement) el.scrollTop = node.offsetTop
    seenId.current = rowsRef.current.at(-1)?.id
    if (el.scrollHeight - el.clientHeight < NEAR_BOTTOM) {
      nearBottom.current = true
      caughtUp.current?.()
      return
    }
    nearBottom.current = false
  }, [anchorId])

  useLayoutEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    const stick = () => {
      const list = rowsRef.current
      if (!nearBottom.current) {
        setFresh(countAfter(list, seenId.current))
        return
      }
      sticking.current = true
      el.scrollTop = el.scrollHeight
      sticking.current = false
      seenId.current = list.at(-1)?.id
      setFresh(0)
      caughtUp.current?.()
    }
    stick()
    const observer = new ResizeObserver(stick)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [tail, pin])

  const jump = () => {
    const el = scroller.current
    if (!el) return
    nearBottom.current = true
    el.scrollTop = el.scrollHeight
    settle(true)
  }

  return (
    <div className="room-stream" ref={scroller} onScroll={onScroll}>
      <div ref={content}>
        {hasOlder && (
          <button type="button" className="room-load-older" disabled={loadingOlder} onClick={onLoadOlder}>
            {loadingOlder ? 'Loading older messages…' : 'Load older messages'}
          </button>
        )}
        {turns.map((turn) => (
          <article key={turn.id} className="room-turn" data-unread={turn.unread || undefined}>
            {turn.unread && <p className="room-unread">New messages</p>}
            <span className="room-avatar" data-photo={turn.avatarUrl ? '' : undefined}>
              {turn.avatarUrl ? <img src={turn.avatarUrl} alt="" /> : mark(turn.author)}
            </span>
            <div className="room-body">
              <header className="room-byline">
                <PersonName className="room-who" name={turn.author} tag={turn.tag} />
                <When iso={turn.postedAt} />
              </header>
              {turn.rows.map((row) => <Entry key={row.id} row={row} />)}
            </div>
          </article>
        ))}
      </div>
      {fresh > 0 && (
        <button type="button" className="room-jump" onClick={jump}>
          ↓ {fresh} new
        </button>
      )}
    </div>
  )
}

export function stillsFrom(media: Media[] | undefined): StreamMedia[] {
  return (media ?? []).map((item) => ({
    type: item.type,
    url: item.url,
    poster: item.poster,
    title: item.title,
    name: item.name,
    embeddable: item.embeddable,
  }))
}
