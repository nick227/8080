import { useBackground, type BackgroundMode } from '../state/background'
import { currentMaskSource, fallbacks, loadMaskSource, subscribeMaskSource } from './vbg/maskSource'
import { createStabilizer } from './vbg/stabilizer'
import type { MaskSource } from './vbg/types'

// Virtual background (doc/07-virtual-background-plan.md). Four replaceable stages:
// camera frame → mask source (vbg/maskSource.ts) → temporal stabilizer (vbg/stabilizer.ts)
// → this compositor (Blur / Photo rendering, polish, frame budget). One canvas per
// compositor is the recording source; a second canvas is the on-screen preview
// (mirrored like a selfie view, with a replacement photo kept readable). The compositor
// never opens or stops the camera: its owner does (framing in CameraPreview, recording
// in useMediaCapture).

// Gecko by feature, not user agent (UAs get overridden).
export const isFirefox = typeof CSS !== 'undefined' && CSS.supports('-moz-appearance', 'none')

/** Front cameras are shown mirrored while framing; recordings never are. */
export const facingUser = (stream: MediaStream) =>
  stream.getVideoTracks()[0]?.getSettings().facingMode === 'user'

export { currentMaskSource, loadMaskSource }

/** Loads the mask source for the chosen mode, reflecting progress in the background store. */
export function ensureMaskSource() {
  const store = useBackground.getState()
  if (store.mode === 'original' || store.status === 'ready' || store.status === 'loading' || store.status === 'unavailable') return
  store.setStatus('loading')
  loadMaskSource().then(
    () => { if (useBackground.getState().status === 'loading') useBackground.getState().setStatus('ready') },
    () => useBackground.getState().setStatus('unavailable', 'Background effects aren’t available on this device'),
  )
}

/** What the camera should show now: the chosen mode, unless effects are unavailable. */
export function effectiveMode(): BackgroundMode {
  const { mode, status } = useBackground.getState()
  return status === 'unavailable' ? 'original' : mode
}

// ─── compositor ───────────────────────────────────────────────────────────────
export type CompositorOptions = { mode: 'blur' | 'photo'; photoUrl: string | null; mirror: boolean; /** recording: never resize mid-take */ fixedSize?: boolean }

export type Compositor = {
  /** The composited video for MediaRecorder (no audio). */
  stream: MediaStream
  /** The on-screen canvas (mirrored for a front camera, photo kept readable). */
  preview: HTMLCanvasElement
  setOptions: (options: Partial<CompositorOptions>) => void
  stop: () => void
}

const MAX_W = 1920 // never downscale a 720p/1080p camera; the canvas is the camera's size

// Tuning (temporary, for evaluation): localStorage '8080.vbg-tune' =
// {"polish":bool,"blurRes":"half"|"quarter"}. The mask source is chosen separately
// (localStorage '8080.vbg-source', see vbg/maskSource.ts).
type Tune = { polish: boolean; blurRes: 'half' | 'quarter' }
function readTune(): Tune {
  try {
    const raw = JSON.parse(localStorage.getItem('8080.vbg-tune') ?? 'null') as Partial<Tune> | null
    return { polish: raw?.polish !== false, blurRes: raw?.blurRes === 'quarter' ? 'quarter' : 'half' }
  } catch {
    return { polish: true, blurRes: 'half' }
  }
}

/** Live numbers for the developer readout (features/room/VbgReadout.tsx), per backend. */
export type VbgStats = {
  backend: string; camera: string; canvas: string; maskInput: string; mask: string
  inferMs: number; maskFps: number; mainSegMs: number; drawMs: number; fps: number; tier: number
  fg: number; flicker: number; polish: boolean; blur: string; fallbacks: string; failed: boolean
}
export let vbgStats: VbgStats | null = null
export let vbgRecording: { mime: string; videoBitsPerSecond: number } | null = null
export function setVbgRecording(info: typeof vbgRecording) { vbgRecording = info }
const WINDOW_MS = 2000 // quality is judged over this window

// What this device can afford, learned by the framing compositor and inherited by the
// recording one (which then never changes size mid-take). Budget ladder when a frame
// doesn't fit: polish off → quarter-size blur → canvas ≤1280 wide → segment every 2nd
// frame → Original.
// The ladder also climbs back: once frames have headroom, the most recently dropped
// step (canvas size first) is retried for one window; if it doesn't fit, it's reverted
// and not retried for 30 s. Startup is expensive, so one-way steps stuck too low.
type Step = 'canvas' | 'blur' | 'polish'
const learned = { maxW: MAX_W, polish: true, blurHalf: true, blockedUntil: { canvas: 0, blur: 0, polish: 0 } as Record<Step, number> }

function canvas(w = 2, h = 2) {
  const el = document.createElement('canvas')
  el.width = w
  el.height = h
  return el
}

function ctx2d(el: HTMLCanvasElement) {
  const ctx = el.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return ctx
}

// Cover-fit `img` into w×h.
function cover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

/** The size the compositor will record for a camera of this size (what the ladder allows now). */
export function compositorOutputSize(width: number, height: number) {
  const scale = Math.min(1, learned.maxW / (width || 1))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export function startCompositor(initialSource: MaskSource, camera: MediaStream, initial: CompositorOptions, onUnavailable: (message: string) => void): Compositor {
  let source = initialSource
  let options = { ...initial }
  const tune = readTune()
  let polish = tune.polish && learned.polish
  let maxW = learned.maxW
  let blurHalf = tune.blurRes === 'half' && learned.blurHalf
  let trial: Step | null = null
  let calm = 0 // consecutive windows with headroom
  const setStep = (step: Step, on: boolean) => {
    if (step === 'canvas') { maxW = on ? MAX_W : 1280; learned.maxW = maxW }
    if (step === 'blur') { blurHalf = on; learned.blurHalf = on }
    if (step === 'polish') { polish = on; learned.polish = on; bakePhoto() }
  }
  const restorable = (step: Step, now: number) => {
    if (now < learned.blockedUntil[step]) return false
    if (step === 'canvas') return maxW < MAX_W && video.videoWidth > maxW
    if (step === 'blur') return tune.blurRes === 'half' && !blurHalf && options.mode === 'blur' && nativeBlur
    return tune.polish && !polish && nativeBlur
  }
  let stopped = false
  let failed = false // too slow or broken: raw camera from here on

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = camera
  void video.play().catch(() => undefined)

  const out = canvas()
  const preview = canvas()
  const outCtx = ctx2d(out)
  const previewCtx = ctx2d(preview)
  const person = canvas()
  const personCtx = ctx2d(person)
  const segIn = canvas() // the frame resized to the mask source's input size
  const segCtx = ctx2d(segIn)
  const stabilizer = createStabilizer()
  const maskCanvas = stabilizer.alpha
  const ringCanvas = stabilizer.ring
  // Blur background: built from the raw camera only, opaque, redrawn every frame.
  // Halving steps average pixels (one big downscale aliases in Firefox: thin dark
  // details became solid black blocks), then a real blur at quarter size.
  const halfC = canvas()
  const halfCtx = ctx2d(halfC)
  const quarterC = canvas()
  const quarterCtx = ctx2d(quarterC)
  const eighthC = canvas()
  const eighthCtx = ctx2d(eighthC)
  const sixteenthC = canvas()
  const sixteenthCtx = ctx2d(sixteenthC)
  const blurHalfC = canvas() // the blurred background at half size (2× upscale only)
  const blurHalfCtx = ctx2d(blurHalfC)
  const nativeBlur = (() => { quarterCtx.filter = 'blur(2px)'; const ok = quarterCtx.filter === 'blur(2px)'; quarterCtx.filter = 'none'; return ok })()
  let blurSource: HTMLCanvasElement = quarterC
  const photoBase = canvas() // softened once per photo/size
  const photoBaseCtx = ctx2d(photoBase)
  const photo = canvas() // base + brightness, rebaked when the match moves
  const photoCtx = ctx2d(photo)
  let photoImage: HTMLImageElement | null = null
  let photoMean = 0 // mean luminance of the photo (0–255), for brightness matching
  let bright = 1 // brightness applied to the photo, eased toward the camera's
  // Polish layers: an edge ring (where the matte isn't fully opaque), a foreground-only
  // soft copy for colour decontamination, and a soft contact shadow.
  const softC = canvas()
  const softCtx = ctx2d(softC)
  const shadowC = canvas()
  const shadowCtx = ctx2d(shadowC)
  const MAX_PREVIEW_W = 1280 // the on-screen canvas never needs more than this
  let PW = 0
  let PH = 0

  let W = 0
  let H = 0

  // Sized from the track's reported size up front (then from the video once it plays),
  // so a recorder never starts on a placeholder canvas: Firefox's MediaRecorder can lock
  // onto the starting size.
  const ensureSize = (reported?: { width?: number; height?: number }) => {
    const vw = reported?.width ?? video.videoWidth
    const vh = reported?.height ?? video.videoHeight
    if (!vw || !vh) return false
    const scale = Math.min(1, maxW / vw)
    const w = Math.round(vw * scale)
    const h = Math.round(vh * scale)
    if (w === W && h === H) return true
    W = w
    H = h
    for (const el of [out, person, photo, photoBase]) { el.width = W; el.height = H }
    PW = Math.min(W, MAX_PREVIEW_W)
    PH = Math.round((PW * H) / W)
    preview.width = PW
    preview.height = PH
    const input = source.inputSize(W, H)
    segIn.width = input.width
    segIn.height = input.height
    const fit = (el: HTMLCanvasElement, d: number) => { el.width = Math.max(2, Math.round(W / d)); el.height = Math.max(2, Math.round(H / d)) }
    fit(halfC, 2); fit(blurHalfC, 2); fit(quarterC, 4); fit(eighthC, 8); fit(sixteenthC, 16); fit(softC, 4); fit(shadowC, 4)
    for (const c of [outCtx, previewCtx, personCtx, segCtx, halfCtx, blurHalfCtx, quarterCtx, eighthCtx, sixteenthCtx, photoCtx, photoBaseCtx, softCtx, shadowCtx]) {
      c.imageSmoothingEnabled = true
      c.imageSmoothingQuality = 'high'
    }
    paintPhoto()
    return true
  }

  // The replacement photo is softened a touch, its contrast eased, and its brightness
  // matched to the camera so person and room stop fighting each other. Repainted only
  // when the photo, size or matched brightness changes.
  const paintPhoto = () => {
    if (!photoImage || !W) return
    const soft = Math.max(1, W / 900)
    photoBaseCtx.save()
    photoBaseCtx.clearRect(0, 0, W, H) // clear + draw, not 'copy' + filter (see blurInto)
    photoBaseCtx.filter = nativeBlur ? `blur(${soft}px) contrast(0.92)` : 'none'
    // Overscan so the softening never pulls in transparent edge pixels.
    const pad = soft * 3
    const scale = Math.max((W + pad * 2) / photoImage.width, (H + pad * 2) / photoImage.height)
    const dw = photoImage.width * scale
    const dh = photoImage.height * scale
    photoBaseCtx.drawImage(photoImage, (W - dw) / 2, (H - dh) / 2, dw, dh)
    photoBaseCtx.restore()
    bakePhoto()
  }
  // Brightness baked into the photo canvas only when the match moves (not per frame):
  // a black wash darkens, a white 'screen' wash brightens — no filter.
  let bakedBright = 1
  const bakePhoto = () => {
    bakedBright = polish ? bright : 1
    photoCtx.save()
    photoCtx.globalCompositeOperation = 'copy'
    photoCtx.drawImage(photoBase, 0, 0)
    photoCtx.globalCompositeOperation = bakedBright < 1 ? 'source-over' : 'screen'
    if (Math.abs(bakedBright - 1) >= 0.01) {
      photoCtx.globalAlpha = bakedBright < 1 ? 1 - bakedBright : Math.min(0.5, bakedBright - 1)
      photoCtx.fillStyle = bakedBright < 1 ? '#000' : '#fff'
      photoCtx.fillRect(0, 0, W, H)
    }
    photoCtx.restore()
  }
  const drawPhoto = (ctx: CanvasRenderingContext2D, w: number, h: number) => ctx.drawImage(photo, 0, 0, w, h)
  const measure = (source: CanvasImageSource) => {
    const c = canvas(32, 18)
    const x = ctx2d(c)
    x.drawImage(source, 0, 0, 32, 18)
    const d = x.getImageData(0, 0, 32, 18).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!
    return sum / (d.length / 4)
  }

  const loadPhoto = (url: string | null) => {
    if (!url) { photoImage = null; return }
    const img = new Image()
    img.src = url
    void img.decode().then(() => {
      if (stopped || options.photoUrl !== url) return
      photoImage = img
      photoMean = measure(img)
      paintPhoto()
    }).catch(() => undefined)
  }
  loadPhoto(options.photoUrl)

  ensureSize(camera.getVideoTracks()[0]?.getSettings())

  // Ease the photo's brightness toward the light on the person (person-weighted mean
  // luminance of the segmentation frame), part-way and clamped: a match, not a flood.
  let maskNo = 0
  const matchBrightness = () => {
    const m = stabilizer.confidence()
    const { width: w, height: h } = stabilizer.size()
    if (!m || !photoImage || !photoMean || segIn.width !== w || segIn.height !== h) return
    const d = segCtx.getImageData(0, 0, w, h).data
    let sum = 0
    let weight = 0
    for (let i = 0; i < m.length; i++) {
      const k = m[i]!
      if (k < 0.5) continue
      sum += k * (0.2126 * d[i * 4]! + 0.7152 * d[i * 4 + 1]! + 0.0722 * d[i * 4 + 2]!)
      weight += k
    }
    if (weight < m.length * 0.02) return
    const target = Math.min(1.25, Math.max(0.75, Math.sqrt(sum / weight / photoMean)))
    bright += (target - bright) * 0.3
    if (Math.abs(bright - bakedBright) > 0.02) bakePhoto()
  }

  // ── quality: every frame ⇄ every 2nd frame → raw camera ──
  // Every browser starts at full rate; the measured cost decides (a real Firefox webcam
  // test ran 20 ms segmentation, so the old Firefox-starts-halved guess threw frames away).
  let tier = 0
  let frameNo = 0
  let windowStart = performance.now()
  let windowFrames = 0
  let windowMainSegMs = 0 // main-thread time spent starting/running inference
  let windowInferMs = 0 // wall time per inference (GPU sources run off the main thread)
  let windowMasks = 0
  let windowDrawMs = 0
  let errors = 0
  let inFlight = false

  const giveUp = (message: string) => {
    if (failed) return
    failed = true
    onUnavailable(message)
  }

  const judge = (now: number) => {
    if (now - windowStart < WINDOW_MS) return
    const fps = (windowFrames * 1000) / (now - windowStart)
    const masksPerSec = (windowMasks * 1000) / (now - windowStart)
    const inferMs = windowMasks ? windowInferMs / windowMasks : 0
    // Main-thread cost per frame from inference (all of it for a sync source).
    const segMs = windowFrames ? windowMainSegMs / Math.max(1, windowMasks) : 0
    const { fg, flicker } = stabilizer.takeStats()
    const mask = stabilizer.size()
    vbgStats = {
      backend: source.backend,
      camera: `${video.videoWidth}×${video.videoHeight}`,
      canvas: `${W}×${H}`,
      maskInput: `${segIn.width}×${segIn.height}`,
      mask: `${mask.width}×${mask.height}`,
      inferMs: Math.round(inferMs * 10) / 10,
      maskFps: Math.round(masksPerSec * 10) / 10,
      mainSegMs: Math.round(segMs * 10) / 10,
      drawMs: Math.round((windowFrames ? windowDrawMs / windowFrames : 0) * 10) / 10,
      fps: Math.round(fps * 10) / 10,
      tier,
      fg: Math.round(fg * 10) / 10,
      flicker: Math.round(flicker * 10) / 10,
      polish,
      blur: `${nativeBlur ? 'filter' : 'fallback'} ${blurSource.width}×${blurSource.height}`,
      fallbacks: fallbacks.map((f) => `${f.source}: ${f.reason}`).join('; '),
      failed,
    }
    const drawMs = windowFrames ? windowDrawMs / windowFrames : 0
    // Budget = the camera's own frame interval (a 25 fps webcam gives 40 ms), less a margin.
    const cameraFps = camera.getVideoTracks()[0]?.getSettings().frameRate || 30
    const budget = 1000 / Math.min(30, cameraFps) - 3
    const over = segMs > 35 || fps < 20 || segMs + drawMs > budget
    if (tier === 0 && trial) {
      // A climb-back trial ran this window: keep it if it fit, else revert and wait.
      if (over) {
        setStep(trial, false)
        learned.blockedUntil[trial] = now + 30_000
      }
      trial = null
      calm = 0
    } else if (tier === 0 && over) {
      calm = 0
      // Keep full-rate segmentation (it's what tracks moving hands) as long as possible.
      if (polish) setStep('polish', false)
      else if (blurHalf && options.mode === 'blur') setStep('blur', false) // half-size blur ≈ +7 ms (Firefox, 720p)
      else if (W > 1280 && !options.fixedSize) setStep('canvas', false)
      else tier = 1
    } else if (tier === 0) {
      // Headroom: after two calm windows, retry the most valuable dropped step. Never
      // while recording (fixedSize) — a take shouldn't change cost mid-way.
      if (!options.fixedSize && ++calm >= 2 && segMs + drawMs < budget - 4) {
        const step = (['canvas', 'blur', 'polish'] as Step[]).find((s) => restorable(s, now))
        if (step) {
          setStep(step, true)
          trial = step
          calm = 0
        }
      }
    } else if (tier === 1 && segMs + drawMs < budget - 2) tier = 0 // a full-rate frame fits again
    else if (tier === 1 && (segMs > 60 || fps < 12)) giveUp('Background effects are too slow on this device')
    windowStart = now
    windowFrames = 0
    windowMainSegMs = 0
    windowInferMs = 0
    windowMasks = 0
    windowDrawMs = 0
  }

  // One inference in flight at a time. A GPU source runs off the main thread, so frames
  // keep drawing (with the last stabilized mask) while it works; a sync source runs here.
  const segment = (now: number) => {
    if (inFlight) return
    segCtx.drawImage(video, 0, 0, segIn.width, segIn.height)
    const t0 = performance.now()
    let pending: Promise<unknown>
    try {
      inFlight = true
      pending = source.run(segIn, now).then((mask) => {
        // A sync source's work happened inside run(); its settle time would include drawing.
        if (!source.sync) windowInferMs += performance.now() - t0
        windowMasks++
        if (!mask) return
        stabilizer.update(mask)
        if (polish && ++maskNo % 15 === 0) matchBrightness()
        errors = 0
      })
    } catch (error) {
      pending = Promise.reject(error)
    }
    const mainMs = performance.now() - t0
    windowMainSegMs += mainMs
    if (source.sync) windowInferMs += mainMs
    pending.catch(() => {
      // Hold the last mask (the stabilizer goes stale → raw camera); give up after 3.
      if (++errors >= 3) giveUp('Background effects stopped working')
    }).finally(() => { inFlight = false })
  }

  // Overscan by twice the radius so the canvas edge (transparent) never bleeds inward.
  // An opaque fill + normal 'source-over' drawing, not 'copy' + filter: GPU canvases
  // (Firefox/Direct2D) may not honour a filter together with 'copy'.
  const blurInto = (ctx: CanvasRenderingContext2D, el: HTMLCanvasElement, source: CanvasImageSource, radius: number) => {
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.filter = 'none'
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, el.width, el.height)
    ctx.filter = `blur(${radius}px)`
    ctx.drawImage(source, -radius * 2, -radius * 2, el.width + radius * 4, el.height + radius * 4)
    ctx.restore()
  }
  const drawBlur = (target: CanvasRenderingContext2D) => {
    // Blur at half size from a 2× averaged copy of the raw camera, then a 2× upscale:
    // little enough enlargement that no pixel structure (blocks) can show.
    halfCtx.drawImage(video, 0, 0, halfC.width, halfC.height)
    if (nativeBlur && blurHalf) {
      blurInto(blurHalfCtx, blurHalfC, halfC, 10) // ≈ 20 px at full size
      blurSource = blurHalfC
    } else if (nativeBlur) {
      blurInto(quarterCtx, quarterC, halfC, 5)
      blurSource = quarterC
    } else {
      // No ctx.filter (Safari): keep averaging down; the bilinear upscale is the blur.
      quarterCtx.drawImage(halfC, 0, 0, quarterC.width, quarterC.height)
      eighthCtx.drawImage(quarterC, 0, 0, eighthC.width, eighthC.height)
      sixteenthCtx.drawImage(eighthC, 0, 0, sixteenthC.width, sixteenthC.height)
      blurSource = sixteenthC
    }
    target.save()
    target.globalCompositeOperation = 'source-over'
    target.globalAlpha = 1
    target.filter = 'none'
    target.drawImage(blurSource, 0, 0, W, H)
    target.restore()
  }

  const draw = (now: number) => {
    const mirror = options.mirror
    const stale = failed || !stabilizer.usable(now)
    if (stale) {
      // Raw camera (no mask yet, or segmentation stopped): never a frozen cutout.
      outCtx.drawImage(video, 0, 0, W, H)
      previewCtx.save()
      if (mirror) { previewCtx.translate(PW, 0); previewCtx.scale(-1, 1) }
      previewCtx.drawImage(video, 0, 0, PW, PH)
      previewCtx.restore()
      return
    }
    personCtx.globalCompositeOperation = 'copy'
    personCtx.drawImage(video, 0, 0, W, H)
    personCtx.globalCompositeOperation = 'destination-in'
    personCtx.drawImage(maskCanvas, 0, 0, W, H)
    personCtx.globalCompositeOperation = 'source-over'

    if (nativeBlur && polish) {
      // Edge colour decontamination: a blurred copy of the cut-out person averages only
      // foreground colour (alpha-weighted), so over the edge ring it replaces the old
      // room's colour in the fringe without shrinking the person.
      softCtx.save()
      softCtx.clearRect(0, 0, softC.width, softC.height)
      softCtx.filter = 'blur(1.5px)' // quarter size ≈ 6 px at full
      softCtx.drawImage(person, 0, 0, softC.width, softC.height)
      softCtx.filter = 'none'
      softCtx.globalCompositeOperation = 'destination-in'
      softCtx.drawImage(ringCanvas, 0, 0, softC.width, softC.height)
      softCtx.restore()
      personCtx.globalCompositeOperation = 'source-atop'
      personCtx.drawImage(softC, 0, 0, W, H)
      personCtx.globalCompositeOperation = 'source-over'
    }

    const photoMode = options.mode === 'photo' && photoImage
    const withShadow = photoMode && nativeBlur && polish
    if (withShadow) {
      // Soft contact shadow, a few pixels down-right: seats the person in the room.
      shadowCtx.save()
      shadowCtx.clearRect(0, 0, shadowC.width, shadowC.height)
      shadowCtx.filter = 'blur(4px)'
      shadowCtx.drawImage(maskCanvas, 0, 0, shadowC.width, shadowC.height)
      shadowCtx.filter = 'none'
      shadowCtx.globalCompositeOperation = 'source-in'
      shadowCtx.fillStyle = '#000'
      shadowCtx.fillRect(0, 0, shadowC.width, shadowC.height)
      shadowCtx.restore()
    }
    const shadow = (ctx: CanvasRenderingContext2D, w: number, h: number, flip: boolean) => {
      if (!withShadow) return
      ctx.save()
      ctx.globalAlpha = 0.28
      ctx.drawImage(shadowC, (flip ? -1 : 1) * w * 0.008, h * 0.012, w, h)
      ctx.restore()
    }

    if (photoMode) drawPhoto(outCtx, W, H)
    else drawBlur(outCtx)
    shadow(outCtx, W, H, false)
    outCtx.drawImage(person, 0, 0)

    if (!mirror) {
      previewCtx.drawImage(out, 0, 0, PW, PH)
      return
    }
    // Mirrored selfie view: the person (and a blurred room) flip; a photo stays readable.
    if (photoMode) drawPhoto(previewCtx, PW, PH)
    previewCtx.save()
    previewCtx.translate(PW, 0)
    previewCtx.scale(-1, 1)
    if (!photoMode) previewCtx.drawImage(blurSource, 0, 0, PW, PH)
    shadow(previewCtx, PW, PH, true)
    previewCtx.drawImage(person, 0, 0, PW, PH)
    previewCtx.restore()
  }
  // ── frame loop: one composite per camera frame where supported ──
  const hasRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype
  let handle = 0
  const schedule = () => {
    if (stopped) return
    if (hasRvfc) handle = video.requestVideoFrameCallback(() => frame())
    else handle = requestAnimationFrame(() => frame())
  }
  const frame = () => {
    if (stopped) return
    const now = performance.now()
    if (video.readyState >= 2 && ensureSize()) {
      if (!failed && frameNo % (tier + 1) === 0) segment(now)
      frameNo++
      const drawStart = performance.now()
      draw(now)
      windowDrawMs += performance.now() - drawStart
      windowFrames++
      if (!failed) judge(now)
    }
    schedule()
  }
  schedule()

  const stream = out.captureStream(30)

  // A better source (MODNet finished loading) is adopted while framing only; a
  // recording keeps the source it started with. The stabilizer re-seeds on the new
  // mask size; an inference already in flight on the old source just completes.
  const unsubscribe = options.fixedSize ? () => {} : subscribeMaskSource((next) => {
    source = next
    if (!W) return
    const input = source.inputSize(W, H)
    segIn.width = input.width
    segIn.height = input.height
    segCtx.imageSmoothingEnabled = true
    segCtx.imageSmoothingQuality = 'high'
  })

  return {
    stream,
    preview,
    setOptions: (next) => {
      const photoChanged = next.photoUrl !== undefined && next.photoUrl !== options.photoUrl
      options = { ...options, ...next }
      if (photoChanged) loadPhoto(options.photoUrl)
    },
    stop: () => {
      stopped = true
      unsubscribe()
      if (hasRvfc) video.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
      stream.getTracks().forEach((track) => track.stop())
      video.srcObject = null
    },
  }
}
