import { useState } from 'react'
import { parseYouTubeVideoId, youTubeThumbnailUrl } from '@project/shared'
import { formatMoment } from '../utils/anchor'
import type { Item } from '../api/types'
import './responseMap.css'

type ById = Record<string, Item>
type Children = Record<string, string[]>

const byTime = (a: Item, b: Item) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)

function ThumbImage({ src, kind }: { src: string; kind: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="response-fallback">{kind}</span>
  return <img src={src} alt="" onError={() => setFailed(true)} />
}

function repliesTo(childrenById: Children, itemsById: ById, parentId: string): Item[] {
  return (childrenById[parentId] ?? [])
    .map((id) => itemsById[id])
    .filter((item): item is Item => !!item && (!!item.text || !!item.media?.length))
    .sort(byTime)
}

function thumbSrc(item: Item): string | undefined {
  const media = item.media?.find((m) => m.type === 'video' || m.type === 'image')
  if (!media) return undefined
  if (media.poster) return media.poster
  if (media.type === 'image') return media.url
  const id = media.externalId || parseYouTubeVideoId(media.url)
  return id ? youTubeThumbnailUrl(id) : undefined
}

// Direct responses sit in a horizontal row of thumbnails under a video.
// One more row nests under each of those, so a reply-to-a-reply stays on the map.
export function ResponseMap({ parentId, itemsById, childrenById, activeId, focusIds, onOpen, layers = 2 }: {
  parentId: string
  itemsById: ById
  childrenById: Children
  activeId?: string
  focusIds?: Set<string>
  onOpen: (id: string) => void
  layers?: number
}) {
  const items = repliesTo(childrenById, itemsById, parentId)
  if (!items.length) return null
  return (
    <div className="response-row" role="list">
      {items.map((item) => (
        <ResponseColumn
          key={item.id}
          item={item}
          depth={0}
          layers={layers}
          itemsById={itemsById}
          childrenById={childrenById}
          activeId={activeId}
          focusIds={focusIds}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

function ResponseColumn({ item, depth, layers, itemsById, childrenById, activeId, focusIds, onOpen }: {
  item: Item
  depth: number
  layers: number
  itemsById: ById
  childrenById: Children
  activeId?: string
  focusIds?: Set<string>
  onOpen: (id: string) => void
}) {
  const children = repliesTo(childrenById, itemsById, item.id)
  const nested = depth < layers - 1 ? children : []
  const hidden = depth >= layers - 1 ? children.length : 0
  const src = thumbSrc(item)
  const kind = item.media?.some((m) => m.type === 'video') ? 'VIDEO' : item.media?.some((m) => m.type === 'audio') ? 'AUDIO' : item.media?.some((m) => m.type === 'image') ? 'IMAGE' : ''
  const marked = item.id === activeId || !!focusIds?.has(item.id)
  const when = item.anchorStartMs != null ? formatMoment(item.anchorStartMs) : ''

  return (
    <div className="response-col" role="listitem">
      <button
        type="button"
        className="response-thumb"
        data-reply-id={item.id}
        data-open={marked || undefined}
        aria-label={when ? `${when}${item.text ? `, ${item.text}` : ''}` : item.text || kind || 'Reply'}
        onClick={() => onOpen(item.id)}
      >
        {src ? <ThumbImage src={src} kind={kind} /> : <span className="response-fallback">{kind}</span>}
        {when && <span className="response-time">{when}</span>}
        {hidden > 0 && <span className="response-more">+{hidden}</span>}
      </button>
      {item.text && <p className="response-caption">{item.text}</p>}
      {nested.length > 0 && (
        <div className="response-nest">
          {nested.map((child) => (
            <ResponseColumn
              key={child.id}
              item={child}
              depth={depth + 1}
              layers={layers}
              itemsById={itemsById}
              childrenById={childrenById}
              activeId={activeId}
              focusIds={focusIds}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}
