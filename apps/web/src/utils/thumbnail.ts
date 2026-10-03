// Conversation thumbnails made in the browser: a still from a captured video, or a
// plain title card. Both come back as JPEG blobs ready for uploadMedia.

const W = 1280
const H = 720

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
}

function once(el: HTMLMediaElement, event: string, ms = 4000) {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    el.addEventListener(event, () => { clearTimeout(timer); resolve(true) }, { once: true })
    el.addEventListener('error', () => { clearTimeout(timer); resolve(false) }, { once: true })
  })
}

// Mean brightness 0–255 of the frame, sampled small.
function brightness(source: HTMLVideoElement) {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 9
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(source, 0, 0, 16, 9)
  const px = g.getImageData(0, 0, 16, 9).data
  let sum = 0
  for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!
  return sum / (px.length / 4)
}

/**
 * A still from a captured video, cover-cropped to 16:9. Recorded webm reports no
 * duration, so pass the capture length (seconds) when known. Skips the dark frames a
 * camera produces while it warms up. Null if the video can't be decoded.
 */
export async function videoFrame(video: Blob, durationSeconds?: number): Promise<Blob | null> {
  const url = URL.createObjectURL(video)
  const el = document.createElement('video')
  el.muted = true
  el.playsInline = true
  el.preload = 'auto'
  el.src = url
  try {
    if (!(await once(el, 'loadeddata'))) return null
    const length = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationSeconds ?? 0
    // Try a third of the way in (at most 1s), then later moments if that is still dark.
    const moments = length > 0 ? [Math.min(1, length / 3), length / 2, length * 0.8] : [0]
    for (const at of moments) {
      if (at > 0) {
        el.currentTime = at
        if (!(await once(el, 'seeked'))) continue
      }
      if (brightness(el) > 18 || at === moments[moments.length - 1]) break
    }
    const vw = el.videoWidth
    const vh = el.videoHeight
    if (!vw || !vh) return null
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const scale = Math.max(W / vw, H / vh)
    canvas.getContext('2d')!.drawImage(el, (W - vw * scale) / 2, (H - vh * scale) / 2, vw * scale, vh * scale)
    return await toJpeg(canvas)
  } catch {
    return null
  } finally {
    el.removeAttribute('src')
    el.load()
    URL.revokeObjectURL(url)
  }
}

/** The title on the dark ground — for conversations made without a picture (dev demo room). */
export async function titleCard(title: string): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0f1115'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#f0ede1'
  ctx.font = '500 96px system-ui, sans-serif'
  ctx.textBaseline = 'bottom'
  ctx.fillText(title.toUpperCase(), 72, H - 72, W - 144)
  return toJpeg(canvas)
}

/** The picture a room thumbnail shows: the image itself, else a video's poster. Never a
 *  YouTube thumbnail's `url` — that's the watch page, not an image. */
export function pictureOf(thumbnail: { type: string; url: string; poster?: string | null } | null | undefined): string | null {
  if (!thumbnail) return null
  return thumbnail.type === 'image' ? thumbnail.url : thumbnail.poster ?? null
}
