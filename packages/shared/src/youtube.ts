// YouTube URL → canonical video id. Shared by server (validation) and web (paste detection).
// Accepts watch?v=, youtu.be/, /embed/, /shorts/, /live/, /v/, m./music./nocookie hosts,
// with extra params (t=, si=, list= alongside v=). Playlist-only links → null.
const ID = /^[A-Za-z0-9_-]{11}$/
const HOSTS = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/

export function parseYouTubeVideoId(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const id = url.pathname.split('/')[1] ?? ''
    return ID.test(id) ? id : null
  }
  if (!HOSTS.test(host)) return null
  const v = url.searchParams.get('v')
  if (url.pathname === '/watch') return v && ID.test(v) ? v : null
  const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)
  return m && ID.test(m[1]!) ? m[1]! : null
}

/** First YouTube video link found in free text (composer paste detection). */
export function findYouTubeVideoId(text: string): { id: string; match: string } | null {
  for (const token of text.split(/\s+/)) {
    if (!/youtu/i.test(token)) continue
    const id = parseYouTubeVideoId(token)
    if (id) return { id, match: token }
  }
  return null
}

export const youTubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`
export const youTubeThumbnailUrl = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
