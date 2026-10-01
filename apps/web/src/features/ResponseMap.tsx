import { useEffect, useState, type ReactNode } from 'react'
import { parseYouTubeVideoId, youTubeThumbnailUrl } from '@project/shared'
import { MinimizeIcon, ReplyIcon } from '../components/icons'
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
  onMinimize: (id: string) => void
  renderPlayer?: (item: Item) => ReactNode
  layers?: number
}

// Each layer is a horizontal row of frames. Three fit the width.
// An opened frame stays full size until minimized. The one playing is one of them.
export function ResponseMap({ activeId, onMinimize, ...props }: MapProps) {
  const [kept, setKept] = useState<Set<string>>(() => new Set())
  // The playing item is open in this render, so the follow scroll can find it.
  const openIds = new Set(kept)
  if (activeId) openIds.add(activeId)
  useEffect(() => {
    if (!activeId) return
    setKept((prev) => (prev.has(activeId) ? prev : new Set(prev).add(activeId)))
  }, [activeId])
  const minimize = (id: string) => {
    setKept((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    onMinimize(id)
  }
  return <ResponseLayer {...props} activeId={activeId} depth={0} openIds={openIds} onMinimize={minimize} />
}

function ResponseLayer({ parentId, itemsById, childrenById, activeId, focusIds, onOpen, onReply, onMinimize, renderPlayer, layers = 2, depth, openIds }: MapProps & { depth: number; openIds: Set<string> }) {
  const items = repliesTo(childrenById, itemsById, parentId)
  if (!items.length) return null
  const blocks: ReactNode[] = []
  let compact: Item[] = []
  const flush = () => {
    if (!compact.length) return
    const row = compact
    compact = []
    blocks.push(
      <div className="response-row" role="list" key={row[0].id}>
        {row.map((item) => (
          <ResponseCard key={item.id} item={item} depth={depth} layers={layers} itemsById={itemsById} childrenById={childrenById} activeId={activeId} focusIds={focusIds} onOpen={onOpen} onReply={onReply} />
        ))}
      </div>,
    )
  }
  for (const item of items) {
    if (!openIds.has(item.id) || !renderPlayer) {
      compact.push(item)
      continue
    }
    flush()
    blocks.push(
      <div className="response-stage" key={item.id} data-playing={item.id === activeId || undefined}>
        <div className="response-open">
          <div className="response-player">{renderPlayer(item)}</div>
          <button type="button" className="response-min" aria-label={`Minimize item ${item.number}`} onClick={() => onMinimize(item.id)}>
            <MinimizeIcon />
          </button>
        </div>
        <ResponseLayer parentId={item.id} depth={depth + 1} openIds={openIds} itemsById={itemsById} childrenById={childrenById} activeId={activeId} focusIds={focusIds} onOpen={onOpen} onReply={onReply} onMinimize={onMinimize} renderPlayer={renderPlayer} layers={layers} />
      </div>,
    )
  }
  flush()

  return (
    <section className="response-layer">
      <p className="response-label">Responses:</p>
      {blocks}
      {items.map((item) => {
        if (openIds.has(item.id)) return null
        const nested = repliesTo(childrenById, itemsById, item.id)
        const show = nested.length > 0 && (depth < layers - 1 || containsActive(itemsById, item.id, activeId))
        if (!show) return null
        return (
          <ResponseLayer
            key={item.id}
            parentId={item.id}
            depth={depth + 1}
            openIds={openIds}
            itemsById={itemsById}
            childrenById={childrenById}
            activeId={activeId}
            focusIds={focusIds}
            onOpen={onOpen}
            onReply={onReply}
            onMinimize={onMinimize}
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
