import type { Item, Media } from '../api/types'

// Anchored replies (V1): a reply may point at a *moment* — a point, not a range —
// in its parent's single audio/video attachment. Mirrors the server rule so the UI
// only offers REPLY HERE where the server will accept it.

/** The one timed attachment an anchor can refer to, or null if anchoring isn't possible. */
export function anchorableMedia(item: Pick<Item, 'media' | 'text'>): Media | null {
  // Count every audio/video attachment exactly as the server does ("exactly one clip")…
  const timed = item.media?.filter((m) => m.type === 'audio' || m.type === 'video') ?? []
  if (timed.length !== 1) return null
  const only = timed[0]!
  // …then that clip must play inline (a non-embeddable YouTube link card can't) with a known duration.
  return only.embeddable !== false && only.duration != null && only.duration > 0 ? only : null
}

/** 01:52 — minutes:seconds of a moment in ms. */
export function formatMoment(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export type Anchor = { id: string; ms: number }
export type AnchorCluster = { ms: number; ids: string[] }

/**
 * Group anchors that would sit closer than `minGapPx` on a rail `widthPx` wide.
 * Purely visual: the data stays individual replies. The cluster sits at its first moment.
 */
export function clusterAnchors(anchors: Anchor[], durationMs: number, widthPx: number, minGapPx = 6): AnchorCluster[] {
  if (!anchors.length || durationMs <= 0) return []
  const sorted = [...anchors].sort((a, b) => a.ms - b.ms)
  const pxPerMs = widthPx > 0 ? widthPx / durationMs : 0
  const clusters: AnchorCluster[] = []
  for (const a of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && (a.ms - last.ms) * pxPerMs < minGapPx) last.ids.push(a.id)
    else clusters.push({ ms: a.ms, ids: [a.id] })
  }
  return clusters
}
