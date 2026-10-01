import { useEffect, useRef, useState } from 'react'
import { clusterAnchors, formatMoment, type Anchor } from '../utils/anchor'

// Where replies attach along a piece of media: a hairline with a point per moment.
// Moments closer than ~6px share one marker with a count (visual only — the data
// stays individual replies). A marker turns signal while one of its replies holds
// the playhead.
export function AnchorRail({ anchors, durationMs, activeId, onSelect }: {
  anchors: Anchor[]
  durationMs: number
  activeId?: string
  onSelect?: (ids: string[], ms: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!anchors.length || durationMs <= 0) return null
  const clusters = clusterAnchors(anchors, durationMs, width)

  return (
    <div className="anchor-rail" ref={ref}>
      {clusters.map((c) => {
        const live = !!activeId && c.ids.includes(activeId)
        const pct = Math.min(100, Math.max(0, (c.ms / durationMs) * 100))
        const n = c.ids.length
        return (
          <button
            key={`${c.ms}-${c.ids[0]}`}
            type="button"
            className="anchor-marker"
            data-live={live || undefined}
            style={{ left: `${pct}%` }}
            aria-label={`${n} ${n === 1 ? 'reply' : 'replies'} at ${formatMoment(c.ms)}`}
            title={formatMoment(c.ms)}
            onClick={(e) => {
              e.stopPropagation() // never toggles playback on the bar beneath
              onSelect?.(c.ids, c.ms)
            }}
          >
            <span className="anchor-point" aria-hidden />
            {n > 1 && <span className="anchor-count" aria-hidden>{n}</span>}
          </button>
        )
      })}
    </div>
  )
}
