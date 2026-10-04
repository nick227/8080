/** Draw one source frame. Later text, filters, and masks paint after this. */
export function paintFrame(ctx: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number) {
  ctx.drawImage(source, 0, 0, width, height)
}

// A still image + audio rendered to a video file. Video takes never come through here:
// their soundtrack is remuxed without touching the picture (remuxSoundtrack.ts).
export type ClipPicture = { kind: 'image'; url: string }

const MIME = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']

function even(value: number) {
  return Math.max(2, Math.round(value / 2) * 2)
}

function frameSize(width: number, height: number) {
  if (!width || !height) throw new Error('Could not read the picture')
  const scale = Math.min(1, 1280 / Math.max(width, height))
  return { width: even(width * scale), height: even(height * scale) }
}

function mount(el: HTMLElement) {
  el.style.position = 'fixed'
  el.style.left = '-10000px'
  el.style.top = '0'
  document.body.append(el)
  return () => el.remove()
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = url
  return img.decode().then(() => img)
}

function recorderMime() {
  const mime = MIME.find(type => MediaRecorder.isTypeSupported(type))
  if (!mime) throw new Error('This browser cannot render the clip')
  return mime
}

export async function composeClip(picture: ClipPicture, audio: AudioBuffer, durationMs: number, audioCtx: AudioContext): Promise<Blob> {
  if (durationMs <= 0) throw new Error('Could not render the clip')
  if (audioCtx.state === 'suspended') await audioCtx.resume()

  const visual = await loadImage(picture.url)
  const size = frameSize(visual.naturalWidth, visual.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not render the clip')

  const mime = recorderMime()
  let removeCanvas = () => {}
  let source: AudioBufferSourceNode | null = null
  let stream: MediaStream | null = null
  const chunks: Blob[] = []
  try {
    removeCanvas = mount(canvas)
    const dest = audioCtx.createMediaStreamDestination()
    source = audioCtx.createBufferSource()
    source.buffer = audio
    source.connect(dest)
    stream = new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ])
    const recorder = new MediaRecorder(stream, { mimeType: mime })
    recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data) }
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve()
      recorder.onerror = () => reject(new Error('Could not render the clip'))
    })
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size.width, size.height)
    paintFrame(ctx, visual, size.width, size.height)
    recorder.start(200)
    const started = performance.now()
    source.start()
    await new Promise<void>(resolve => {
      const draw = () => {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, size.width, size.height)
        paintFrame(ctx, visual, size.width, size.height)
        if (performance.now() - started >= durationMs) resolve()
        else requestAnimationFrame(draw)
      }
      requestAnimationFrame(draw)
    })
    if (recorder.state !== 'inactive') recorder.stop()
    await stopped
  } finally {
    try { source?.stop() } catch { /* already ended */ }
    stream?.getTracks().forEach(track => track.stop())
    removeCanvas()
  }
  if (!chunks.length) throw new Error('Could not render the clip')
  const type = mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm'
  return new Blob(chunks, { type })
}
