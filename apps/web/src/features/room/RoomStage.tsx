import { youTubeThumbnailUrl } from '@project/shared'
import type { Item, Media } from '../../api/types'

const mark = (name: string) => (name.trim().charAt(0) || '?').toUpperCase()

function lead(item: Item): Media | undefined {
  return item.media?.find((media) => media.type === 'image' || media.type === 'video')
    ?? item.media?.find((media) => media.type === 'audio')
}

function stillOf(media: Media) {
  if (media.type === 'image') return media.url
  if (media.poster) return media.poster
  if (media.externalId) return youTubeThumbnailUrl(media.externalId)
  return undefined
}

function Face({ name, avatarUrl, large }: { name: string; avatarUrl?: string; large?: boolean }) {
  return (
    <span className={large ? 'room-live-face' : 'room-avatar'} data-photo={avatarUrl ? '' : undefined}>
      {avatarUrl ? <img src={avatarUrl} alt="" /> : mark(name)}
    </span>
  )
}

export function RoomStage({ item, onOpen }: { item?: Item; onOpen?: () => void }) {
  const media = item ? lead(item) : undefined
  const still = media ? stillOf(media) : undefined
  const open = item && onOpen ? onOpen : undefined

  return (
    <section className="room-live" aria-label="Stage">
      {still ? (
        <button type="button" className="room-live-frame" onClick={open}>
          <img src={still} alt="" />
        </button>
      ) : media?.type === 'video' ? (
        <button type="button" className="room-live-frame" onClick={open}>
          <video src={media.url} muted playsInline preload="metadata" />
        </button>
      ) : item?.text ? (
        <button type="button" className="room-live-frame" onClick={open}>
          <p className="room-live-copy">{item.text}</p>
        </button>
      ) : item ? (
        <button type="button" className="room-live-frame" onClick={open}>
          <Face name={item.author.name} avatarUrl={item.author.avatarUrl} large />
        </button>
      ) : (
        <p className="room-live-empty">Stage is clear</p>
      )}
      {item && (
        <p className="room-live-by">
          <Face name={item.author.name} avatarUrl={item.author.avatarUrl} />
          <span>{item.author.name}</span>
        </p>
      )}
    </section>
  )
}
