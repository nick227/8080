import type { Item as ItemType } from '../../api/types'
import { parseYouTubeVideoId, youTubeThumbnailUrl } from '@project/shared'

export function ResponseStrip({ childrenList, onSelect }: { childrenList: ItemType[], onSelect: (id: string) => void }) {
  
  return (
    <div className="response-strip-container">
      <p className="response-strip-label">RESPONSES</p>
      <div className="response-strip-scroll">
        {childrenList.map(child => (
          <ResponsePreview key={child.id} item={child} onSelect={() => onSelect(child.id)} />
        ))}
      </div>
    </div>
  )
}

function ResponsePreview({ item, onSelect }: { item: ItemType, onSelect: () => void }) {
  const media = item.media?.find((m) => m.type === 'video' || m.type === 'image')
  const kind = item.media?.some((m) => m.type === 'video') ? 'VIDEO' : item.media?.some((m) => m.type === 'audio') ? 'AUDIO' : item.media?.some((m) => m.type === 'image') ? 'IMAGE' : 'TEXT'
  
  let thumbSrc: string | undefined
  if (media) {
    if (media.poster) thumbSrc = media.poster
    else if (media.type === 'image') thumbSrc = media.url
    else {
      const id = media.externalId || parseYouTubeVideoId(media.url)
      if (id) thumbSrc = youTubeThumbnailUrl(id)
    }
  }

  return (
    <button type="button" className="response-preview" aria-label={`View response ${item.number}`} onClick={onSelect}>
      {thumbSrc ? (
        <img src={thumbSrc} alt={kind} className="response-preview-thumb" />
      ) : (
        <div className="response-preview-fallback">
          <span>{kind}</span>
          {item.text && <span className="response-preview-text">{item.text.slice(0, 30)}</span>}
        </div>
      )}
      <div className="response-preview-meta">
        {item.anchorStartMs != null && <span className="response-preview-time">{formatTime(item.anchorStartMs)}</span>}
      </div>
    </button>
  )
}

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
