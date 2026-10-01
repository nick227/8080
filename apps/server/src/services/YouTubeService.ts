import { db } from '@project/db'
import { parseYouTubeVideoId } from '@project/shared'
import { toMedia } from '../lib/serialize'
import { badRequest, httpError } from '../lib/errors'

// YouTube as an external media source. Isolated here: the rest of the server sees an
// ordinary Media row (kind video, source youtube). Nothing is downloaded — we keep the
// canonical id, the oEmbed title, and the client-measured duration (V1 trust model).

export type YouTubeLookup = (videoId: string) => Promise<
  { status: 'ok'; title: string | null } | { status: 'unavailable' } | { status: 'not-embeddable'; title: string | null }
>

const oEmbedLookup: YouTubeLookup = async (videoId) => {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  } catch {
    throw httpError(502, 'Could not reach YouTube', 'YOUTUBE_LOOKUP_FAILED')
  }
  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as { title?: unknown }
    return { status: 'ok', title: typeof body.title === 'string' ? body.title.slice(0, 300) : null }
  }
  // oEmbed answers 401 when the owner disabled embedding; 400/404 when missing/private.
  if (res.status === 401 || res.status === 403) return { status: 'not-embeddable', title: null }
  if (res.status === 400 || res.status === 404) return { status: 'unavailable' }
  throw httpError(502, `YouTube lookup failed (${res.status})`, 'YOUTUBE_LOOKUP_FAILED')
}

let lookup: YouTubeLookup = oEmbedLookup
/** Tests swap in a deterministic lookup (no network). */
export function setYouTubeLookup(fn: YouTubeLookup | null) {
  lookup = fn ?? oEmbedLookup
}

export class YouTubeService {
  async create(ownerId: string, input: { url: string; durationMs?: number; embeddable?: boolean }) {
    const videoId = parseYouTubeVideoId(input.url)
    if (!videoId) throw badRequest('Not a YouTube video link', 'INVALID_YOUTUBE_URL')

    const found = await lookup(videoId)
    if (found.status === 'unavailable') throw badRequest('That YouTube video is unavailable', 'YOUTUBE_UNAVAILABLE')

    // Playable inline only if both YouTube (oEmbed) and the client's player agree.
    const embeddable = found.status === 'ok' && input.embeddable !== false
    const media = await db.media.create({
      data: {
        ownerId,
        kind: 'video',
        source: 'youtube',
        externalId: videoId,
        title: found.title,
        embeddable,
        mimeType: 'video/x-youtube',
        size: 0,
        // No reliable placement without inline playback → no duration → no anchors.
        duration: embeddable && input.durationMs != null && input.durationMs > 0 ? input.durationMs / 1000 : null,
      },
    })
    return toMedia(media)
  }
}
