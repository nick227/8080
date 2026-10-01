import { useState, type ReactNode } from 'react'
import { parseYouTubeVideoId, youTubeThumbnailUrl } from '@project/shared'
import { ReplyIcon } from '../components/icons'
import type { Item } from '../api/types'
import './responseMap.css'

type ById = Record<string, Item>
type Children = Record<string, string[]>

const madeOrder = (a: Item, b: Item) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)

// Moment on the parent first. The same moment, or no moment, stays in the order they were made.
const sequenceOrder = (a: Item, b: Item) => {
  if (a.anchorStartMs != null && b.anchorStartMs != null && a.anchorStartMs !== b.anchorStartMs) {
    return a.anchorStartMs - b.anchorStartMs
  }
  return madeOrder(a, b)
}

function ThumbImage({ src, kind }: { src: string; kind: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="response-fallback">{kind}</span>
  return <img src={src} alt="" onError={() => setFailed(true)} />
}

function repliesTo(childrenById: Children, itemsById: ById, parentId: string): Item[] {
  return (childrenById[parentId] ?? [])
    .map((id) => itemsById[id])
    .filter((item): item is Item => !!item && (!!item.text || !!item.media?.length))
    .sort(sequenceOrder)
}

function containsActive(itemsById: ById, ancestorId: string, activeId?: string): boolean {
  if (!activeId) return false
  let current = itemsById[activeId]?.parentId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = itemsById[current]?.parentId
  }
  return false
}

function thumbSrc(item: Item): string | undefined {
  const media = item.media?.find((m) => m.type === 'video' || m.type === 'image')
  if (!media) return undefined
  if (media.poster) return media.poster
  if (media.type === 'image') return media.url
  const id = media.externalId || parseYouTubeVideoId(media.url)
  return id ? youTubeThumbnailUrl(id) : undefined
}

type MapProps = {
  parentId: string
  itemsById: ById
  childrenById: Children
  activeId?: string
  focusIds?: Set<string>
  onOpen: (id: string) => void
  onReply: (id: string) => void
  renderPlayer?: (item: Item) => ReactNode
  layers?: number
}

// Each layer is a horizontal row of frames. Three fit the width.
// The one playing leaves the row and opens full size, with its own layer beneath.
export function ResponseMap(props: MapProps) {
  return <ResponseLayer {...props} depth={0} />
}

function ResponseLayer({ parentId, itemsById, childrenById, activeId, focusIds, onOpen, onReply, renderPlayer, layers = 2, depth }: MapProps & { depth: number }) {
  const items = repliesTo(childrenById, itemsById, parentId)
  if (!items.length) return null
  const playIdx = items.findIndex((item) => item.id === activeId)
  const before = playIdx < 0 ? items : items.slice(0, playIdx)
  const after = playIdx < 0 ? [] : items.slice(playIdx + 1)
  const playing = playIdx < 0 ? undefined : items[playIdx]

  return (
    <section className="response-layer">
      <p className="response-label">Responses:</p>
      {before.length > 0 && (
        <div className="response-row" role="list">
          {before.map((item) => (
            <ResponseCard key={item.id} item={item} depth={depth} layers={layers} itemsById={itemsById} childrenById={childrenById} activeId={activeId} focusIds={focusIds} onOpen={onOpen} onReply={onReply} />
          ))}
        </div>
      )}
      {playing && renderPlayer && (
        <div className="response-stage" data-playing>
          <div className="response-player">{renderPlayer(playing)}</div>
          <ResponseLayer parentId={playing.id} depth={depth + 1} itemsById={itemsById} childrenById={childrenById} activeId={activeId} focusIds={focusIds} onOpen={onOpen} onReply={onReply} renderPlayer={renderPlayer} layers={layers} />
        </div>
      )}
      {after.length > 0 && (
        <div className="response-row" role="list">
          {after.map((item) => (
            <ResponseCard key={item.id} item={item} depth={depth} layers={layers} itemsById={itemsById} childrenById={childrenById} activeId={activeId} focusIds={focusIds} onOpen={onOpen} onReply={onReply} />
          ))}
        </div>
      )}
      {items.map((item) => {
        if (item.id === playing?.id) return null
        const nested = repliesTo(childrenById, itemsById, item.id)
        const show = nested.length > 0 && (depth < layers - 1 || containsActive(itemsById, item.id, activeId))
        if (!show) return null
        return (
          <ResponseLayer
            key={item.id}
            parentId={item.id}
            depth={depth + 1}
            itemsById={itemsById}
            childrenById={childrenById}
            activeId={activeId}
            focusIds={focusIds}
            onOpen={onOpen}
            onReply={onReply}
            renderPlayer={renderPlayer}
            layers={layers}
          />
        )
      })}
    </section>
  )
}

function ResponseCard({ item, depth, layers, itemsById, childrenById, activeId, focusIds, onOpen, onReply }: {
  item: Item
  depth: number
  layers: number
  itemsById: ById
  childrenById: Children
  activeId?: string
  focusIds?: Set<string>
  onOpen: (id: string) => void
  onReply: (id: string) => void
}) {
  const src = thumbSrc(item)
  const kind = item.media?.some((m) => m.type === 'video') ? 'VIDEO' : item.media?.some((m) => m.type === 'audio') ? 'AUDIO' : item.media?.some((m) => m.type === 'image') ? 'IMAGE' : ''
  const hidden = depth >= layers - 1 && !containsActive(itemsById, item.id, activeId) ? repliesTo(childrenById, itemsById, item.id).length : 0
  const marked = !!focusIds?.has(item.id)
  return (
    <div className="response-card" role="listitem">
      <button type="button" className="response-thumb" data-reply-id={item.id} data-open={marked || undefined} aria-label={item.text || kind || 'Response'} onClick={() => onOpen(item.id)}>
        {src ? <ThumbImage src={src} kind={kind} /> : <span className="response-fallback">{item.text || kind || 'TEXT'}</span>}
        {hidden > 0 && <span className="response-more">+{hidden}</span>}
      </button>
      <ReplyButton item={item} onReply={onReply} />
    </div>
  )
}

function ReplyButton({ item, onReply }: { item: Item; onReply: (id: string) => void }) {
  return (
    <button type="button" className="response-reply" aria-label={`Reply to item ${item.number}`} onClick={() => onReply(item.id)}>
      <ReplyIcon /> Reply
    </button>
  )
}
