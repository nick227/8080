import type { Anchor } from '../../utils/anchor'
import { formatMoment } from '../../utils/anchor'

export function MediaTimeline({ anchors, durationMs, onSelect }: { 
  anchors: Anchor[], 
  durationMs: number,
  onSelect: (ids: string[]) => void 
}) {
  if (durationMs <= 0 || anchors.length === 0) return null

  // Group anchors by approximate time to avoid overlap
  const grouped = anchors.reduce((acc, anchor) => {
    const key = Math.round(anchor.ms / 500) * 500
    if (!acc[key]) acc[key] = []
    acc[key].push(anchor.id)
    return acc
  }, {} as Record<number, string[]>)

  return (
    <div className="media-timeline-overlay">
      <div className="media-timeline-track">
        {Object.entries(grouped).map(([msStr, ids]) => {
          const ms = parseInt(msStr, 10)
          const leftPercent = Math.min(100, Math.max(0, (ms / durationMs) * 100))
          return (
            <button
              key={ms}
              type="button"
              className="media-timeline-notch"
              style={{ left: `${leftPercent}%` }}
              onClick={(e) => {
                e.stopPropagation()
                onSelect(ids)
              }}
              title={`${ids.length} reply${ids.length > 1 ? 'ies' : ''} at ${formatMoment(ms)}`}
            />
          )
        })}
      </div>
    </div>
  )
}
