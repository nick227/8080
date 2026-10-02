import { useRef, useState } from 'react'
import type { Media, MediaType } from '../../api/types'
import { Media as MediaView } from '../../components/Media'
import { getWaveform } from '../../components/Item'
import { controllerWithin } from '../../media/controller'

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
  author: string
  avatarUrl?: string
  postedAt?: string
  text?: string
  media: StreamMedia[]
  status?: 'sending' | 'failed'
  onOpen?: () => void
  onReply?: () => void
  onRetry?: () => void
  onDelete?: () => void
}

const mark = (name: string) => (name.trim().charAt(0) || '?').toUpperCase()

function formatPosted(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

function Byline({ row }: { row: StreamRow }) {
  const posted = row.postedAt ? formatPosted(row.postedAt) : ''
  return (
    <header className="room-byline">
      <span className="room-avatar">
        {row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : mark(row.author)}
      </span>
      <span className="room-who">{row.author}</span>
      {posted && <time className="room-when" dateTime={row.postedAt}>{posted}</time>}
    </header>
  )
}

function Piece({ row, media, onPlaying }: { row: StreamRow; media: StreamMedia; onPlaying: (playing: boolean) => void }) {
  const audio = media.type === 'audio'
  return (
    <div className="room-media">
      <MediaView
        type={media.type}
        src={media.url}
        poster={media.poster}
        name={media.name ?? media.title}
        title={media.title}
        embeddable={media.embeddable}
        waveform={audio ? getWaveform(row.id) : undefined}
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
    <button
      type="button"
      data-armed={armed || undefined}
      onClick={() => {
        if (!armed) { setArmed(true); return }
        onDelete()
      }}
    >
      {armed ? 'Confirm' : 'Delete'}
    </button>
  )
}

function Row({ row }: { row: StreamRow }) {
  const ref = useRef<HTMLElement>(null)
  const [playing, setPlaying] = useState(false)
  const audio = row.media.some((media) => media.type === 'audio')

  const toggle = () => {
    const ctrl = controllerWithin(ref.current)
    if (!ctrl) return
    if (playing) ctrl.pause()
    else void ctrl.play()
  }

  return (
    <article ref={ref} className="room-msg" data-item-id={row.id}>
      <Byline row={row} />
      {row.text && <p className={row.media.length ? 'room-text' : 'room-card'}>{row.text}</p>}
      {row.media.map((media, index) => (
        <Piece key={`${row.id}-${index}`} row={row} media={media} onPlaying={setPlaying} />
      ))}
      <div className="room-actions">
        {row.status === 'sending' && <span className="room-status">Sending</span>}
        {row.status === 'failed' && (
          <button type="button" className="room-status" onClick={row.onRetry}>Didn't send — retry</button>
        )}
        {audio && (
          <button type="button" onClick={toggle} aria-pressed={playing}>
            {playing ? 'Pause' : 'Play'}
          </button>
        )}
        {row.onReply && <button type="button" onClick={row.onReply}>Reply</button>}
        {row.onDelete && <DeleteLink onDelete={row.onDelete} />}
      </div>
    </article>
  )
}

export function ChatStream({ rows }: { rows: StreamRow[] }) {

  return (
    <div className="room-stream">
      {rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
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
