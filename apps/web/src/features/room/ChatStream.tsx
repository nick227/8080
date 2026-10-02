import type { Media, MediaType } from '../../api/types'
import { Media as MediaView } from '../../components/Media'
import { getWaveform } from '../../components/Item'

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

function Piece({ row, media }: { row: StreamRow; media: StreamMedia }) {
  return (
    <div className="room-media">
      <MediaView
        type={media.type}
        src={media.url}
        poster={media.poster}
        name={media.name ?? media.title}
        title={media.title}
        embeddable={media.embeddable}
        waveform={media.type === 'audio' ? getWaveform(row.id) : undefined}
        isActive={false}
      />
    </div>
  )
}

export function ChatStream({ rows }: { rows: StreamRow[] }) {
  if (!rows.length) {
    return <p className="room-empty">This room is quiet. Record something.</p>
  }

  return (
    <div className="room-stream">
      {rows.map((row) => (
        <article key={row.id} className="room-msg" data-item-id={row.id}>
          <Byline row={row} />
          {row.text && <p className={row.media.length ? 'room-text' : 'room-card'}>{row.text}</p>}
          {row.media.map((media, index) => (
            <Piece key={`${row.id}-${index}`} row={row} media={media} />
          ))}
          <div className="room-actions">
            {row.status === 'sending' && <span className="room-status">Sending</span>}
            {row.status === 'failed' && (
              <button type="button" className="room-status" onClick={row.onRetry}>Didn't send — retry</button>
            )}
            {row.onReply && <button type="button" onClick={row.onReply}>Reply</button>}
          </div>
        </article>
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
