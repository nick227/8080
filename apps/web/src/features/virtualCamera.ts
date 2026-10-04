import type { ImageSegmenter } from '@mediapipe/tasks-vision'
import { useBackground, type BackgroundMode } from '../state/background'

// Virtual background (doc/07-virtual-background-plan.md). One canvas per compositor is
// the recording source; a second canvas is the on-screen preview (mirrored like a
// selfie view, with a replacement photo kept readable). The compositor never opens or
// stops the camera: its owner does (framing in CameraPreview, recording in useMediaCapture).

// Gecko by feature, not user agent (UAs get overridden): Firefox starts at the lighter tier.
export const isFirefox = typeof CSS !== 'undefined' && CSS.supports('-moz-appearance', 'none')

/** Front cameras are shown mirrored while framing; recordings never are. */
export const facingUser = (stream: MediaStream) =>
  stream.getVideoTracks()[0]?.getSettings().facingMode === 'user'

// ─── segmenter: one per page, self-hosted runtime, loaded on first use ─────────
let segmenter: Promise<ImageSegmenter> | null = null

export function loadSegmenter(): Promise<ImageSegmenter> {
  segmenter ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe')
    const create = (delegate: 'CPU') => ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite', delegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    })
    // CPU (XNNPACK) everywhere: the selfie model is tiny (~15 ms/frame measured even in
    // headless Chromium), it avoids GPU→CPU mask readback, and MediaPipe's GPU delegate
    // is unreliable in Firefox. Measured GPU in headless (software GL): ~190 ms/frame.
    return create('CPU')
  })().catch((error: unknown) => {
    segmenter = null
    throw error
  })
  return segmenter
}

/** Loads the segmenter for the chosen mode, reflecting progress in the background store. */
export function ensureSegmenter() {
  const store = useBackground.getState()
  if (store.mode === 'original' || store.status === 'ready' || store.status === 'loading' || store.status === 'unavailable') return
  store.setStatus('loading')
  loadSegmenter().then(
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
const NEW = 0.6 // v1 temporal smoothing: weight of the newest mask

// Tuning (temporary, for A/B against real webcams): localStorage '8080.vbg-tune' =
// {"seg":256|384|512,"matte":"v1"|"v2"|"v2-fixed"}. Defaults: 384 px, v2 (adaptive erosion);
// v2-fixed erodes everywhere (the previous v2).
type Tune = { seg: number; matte: 'v1' | 'v2' | 'v2-fixed'; polish: boolean; blurRes: 'half' | 'quarter' }
function readTune(): Tune {
  try {
    const raw = JSON.parse(localStorage.getItem('8080.vbg-tune') ?? 'null') as Partial<Tune> | null
    return { seg: [256, 384, 512].includes(raw?.seg ?? 0) ? raw!.seg! : 384, matte: raw?.matte === 'v1' || raw?.matte === 'v2-fixed' ? raw.matte : 'v2', polish: raw?.polish !== false, blurRes: raw?.blurRes === 'quarter' ? 'quarter' : 'half' }
  } catch {
    return { seg: 384, matte: 'v2', polish: true, blurRes: 'half' }
  }
}

/** Live numbers for the developer readout (features/room/VbgReadout.tsx). */
export type VbgStats = { camera: string; canvas: string; seg: string; segMs: number; segFps: number; drawMs: number; fps: number; tier: number; matte: string; engine: string; fg: number; polish: boolean; blur: string; failed: boolean }
export let vbgStats: VbgStats | null = null
export let vbgRecording: { mime: string; videoBitsPerSecond: number } | null = null
export function setVbgRecording(info: typeof vbgRecording) { vbgRecording = info }
const STALE_MS = 500 // a mask older than this is not trusted: show the raw camera
const WINDOW_MS = 2000 // quality is judged over this window

// The last smoothed mask, so a new compositor (framing → recording) starts with a
// cutout instead of a frame or two of the real room.
let lastMask: { data: Float32Array; w: number; h: number; at: number } | null = null

// What this device can afford, learned by the framing compositor and inherited by the
// recording one (which then never changes size mid-take). Budget ladder when a frame
// doesn't fit: polish off → quarter-size blur → canvas ≤1280 wide → segment every 2nd
// frame → Original.
// The ladder also climbs back: once frames have headroom, the most recently dropped
// step (canvas size first) is retried for one window; if it doesn't fit, it's reverted
// and not retried for 30 s. Startup is expensive, so one-way steps stuck too low.
type Step = 'canvas' | 'blur' | 'polish'
const learned = { maxW: MAX_W, polish: true, blurHalf: true, blockedUntil: { canvas: 0, blur: 0, polish: 0 } as Record<Step, number> }

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

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

export function startCompositor(seg: ImageSegmenter, camera: MediaStream, initial: CompositorOptions, onUnavailable: (message: string) => void): Compositor {
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
  const segIn = canvas()
  const segCtx = ctx2d(segIn)
  const maskCanvas = canvas()
  const maskCtx = ctx2d(maskCanvas)
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
  const ringCanvas = canvas()
  const ringCtx = ctx2d(ringCanvas)
  let ringImage: ImageData | null = null
  const softC = canvas()
  const softCtx = ctx2d(softC)
  const shadowC = canvas()
  const shadowCtx = ctx2d(shadowC)
  const MAX_PREVIEW_W = 1280 // the on-screen canvas never needs more than this
  let PW = 0
  let PH = 0

  let W = 0
  let H = 0
  let smooth: Float32Array | null = null
  let shaped: Float32Array | null = null
  let maskImage: ImageData | null = null
  let maskAt = 0

  const ensureSize = () => {
    const vw = video.videoWidth
    const vh = video.videoHeight
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
    segIn.width = Math.min(tune.seg, W)
    segIn.height = Math.max(2, Math.round((segIn.width * H) / W))
    const fit = (el: HTMLCanvasElement, d: number) => { el.width = Math.max(2, Math.round(W / d)); el.height = Math.max(2, Math.round(H / d)) }
    fit(halfC, 2); fit(blurHalfC, 2); fit(quarterC, 4); fit(eighthC, 8); fit(sixteenthC, 16); fit(softC, 4); fit(shadowC, 4)
    for (const c of [outCtx, previewCtx, personCtx, segCtx, maskCtx, halfCtx, blurHalfCtx, quarterCtx, eighthCtx, sixteenthCtx, photoCtx, photoBaseCtx, ringCtx, softCtx, shadowCtx]) {
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

  // ── mask: smooth over time, soften the confidence edge, feather a little ──
  let eroded: Float32Array | null = null
  let prevRaw: Float32Array | null = null
  let movedMap: Uint8Array | null = null
  const takeMask = (floats: Float32Array, w: number, h: number) => tune.matte === 'v1' ? takeMaskV1(floats, w, h) : takeMaskV2(floats, w, h)

  const prepare = (floats: Float32Array, w: number, h: number) => {
    if (!smooth || smooth.length !== w * h) {
      const seed = lastMask && lastMask.w === w && lastMask.h === h && performance.now() - lastMask.at < 1000 ? lastMask.data : null
      smooth = seed ? Float32Array.from(seed) : Float32Array.from(floats)
      shaped = new Float32Array(w * h)
      eroded = new Float32Array(w * h)
      prevRaw = Float32Array.from(floats)
      maskCanvas.width = w
      maskCanvas.height = h
      maskImage = maskCtx.createImageData(w, h)
      ringCanvas.width = w
      ringCanvas.height = h
      ringImage = ringCtx.createImageData(w, h)
      movedMap = new Uint8Array(w * h)
    }
  }

  // Ease the photo's brightness toward the light on the person (person-weighted mean
  // luminance of the segmentation frame), part-way and clamped: a match, not a flood.
  let maskNo = 0
  const matchBrightness = (m: Float32Array, w: number, h: number) => {
    if (!photoImage || !photoMean || segIn.width !== w || segIn.height !== h) return
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

  // v2 matte: smooth over time where the mask is steady but follow it at once where it
  // moves (no ghost trails); a firm confidence curve; contract the edge by one mask
  // pixel (min filter) so background pixels can't survive in the soft edge (the halo);
  // then only a small feather. Adaptive (default): where the raw mask moved since the
  // previous segmentation (a hand or forearm in motion), the contraction is skipped
  // around it — thin fast limbs would otherwise erode away first — and comes back as
  // soon as that region is still. Static edges (hair, shoulders) keep it: no halo.
  const MOVED = 0.15
  const takeMaskV2 = (floats: Float32Array, w: number, h: number) => {
    prepare(floats, w, h)
    const s = smooth!
    const sh = shaped!
    const er = eroded!
    const prev = prevRaw!
    const adaptive = tune.matte === 'v2'
    for (let i = 0; i < s.length; i++) {
      const next = floats[i]!
      const change = Math.abs(next - s[i]!)
      // Confident, steady pixels (torso, head interior) smooth heavily; uncertain
      // (near 0.5) or changing pixels follow the new mask at once.
      const certainty = Math.abs(s[i]! - 0.5) * 2
      const keep = change > 0.25 ? 0 : 0.75 * certainty * (1 - change * 4)
      s[i] = next * (1 - keep) + s[i]! * keep
      sh[i] = smoothstep(0.4, 0.8, s[i]!)
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let min = 1
        let moved = false
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy))
          for (let dx = -1; dx <= 1; dx++) {
            const j = yy * w + Math.min(w - 1, Math.max(0, x + dx))
            const v = sh[j]!
            if (v < min) min = v
            if (adaptive && Math.abs(floats[j]! - prev[j]!) > MOVED) moved = true
          }
        }
        er[y * w + x] = moved ? sh[y * w + x]! : min
        movedMap![y * w + x] = moved ? 1 : 0
      }
    }
    prev.set(floats)
    const px = maskImage!.data
    const rp = ringImage!.data
    let fg = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        let a: number
        if (movedMap![i]) {
          a = Math.round(er[i]! * 255) // moving: firm edge, no feather (no smear)
        } else {
          let sum = 0
          for (let dy = -1; dy <= 1; dy++) {
            const yy = Math.min(h - 1, Math.max(0, y + dy))
            for (let dx = -1; dx <= 1; dx++) sum += er[yy * w + Math.min(w - 1, Math.max(0, x + dx))]!
          }
          a = Math.round((sum / 9) * 255) // still: small feather
        }
        px[i * 4 + 3] = a
        // Edge ring for decontamination: zero outside and in the solid interior.
        rp[i * 4 + 3] = a < 5 ? 0 : Math.round((1 - smoothstep(0.6, 0.98, a / 255)) * 255)
        if (a > 127) fg++
      }
    }
    ringCtx.putImageData(ringImage!, 0, 0)
    if (polish && ++maskNo % 15 === 0) matchBrightness(sh, w, h)
    windowFg += fg / (w * h)
    windowFgN++
    maskCtx.putImageData(maskImage!, 0, 0)
    maskAt = performance.now()
    lastMask = { data: s, w, h, at: maskAt }
  }

  const takeMaskV1 = (floats: Float32Array, w: number, h: number) => {
    prepare(floats, w, h)
    const s = smooth!
    const sh = shaped!
    for (let i = 0; i < s.length; i++) {
      s[i] = NEW * floats[i]! + (1 - NEW) * s[i]!
      sh[i] = smoothstep(0.3, 0.7, s[i]!)
    }
    // 3×3 box blur at mask resolution ≈ a few pixels of feather at output size.
    const px = maskImage!.data
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            sum += sh[yy * w + xx]!
            n++
          }
        }
        px[(y * w + x) * 4 + 3] = Math.round((sum / n) * 255)
      }
    }
    maskCtx.putImageData(maskImage!, 0, 0)
    maskAt = performance.now()
    lastMask = { data: s, w, h, at: maskAt }
  }

  // ── quality: every frame ⇄ every 2nd frame → raw camera ──
  // Every browser starts at full rate; the measured cost decides (a real Firefox webcam
  // test ran 20 ms segmentation, so the old Firefox-starts-halved guess threw frames away).
  let tier = 0
  let frameNo = 0
  let windowStart = performance.now()
  let windowFrames = 0
  let windowSegMs = 0
  let windowSegs = 0
  let windowDrawMs = 0
  let windowFg = 0 // share of mask pixels that are person (alpha > 50%), averaged per mask
  let windowFgN = 0
  let errors = 0

  const giveUp = (message: string) => {
    if (failed) return
    failed = true
    onUnavailable(message)
  }

  const judge = (now: number) => {
    if (now - windowStart < WINDOW_MS) return
    const fps = (windowFrames * 1000) / (now - windowStart)
    const segMs = windowSegs ? windowSegMs / windowSegs : 0
    vbgStats = {
      camera: `${video.videoWidth}×${video.videoHeight}`,
      canvas: `${W}×${H}`,
      seg: `${segIn.width}×${segIn.height} → mask ${maskCanvas.width}×${maskCanvas.height}`,
      segMs: Math.round(segMs * 10) / 10,
      segFps: Math.round((windowSegs * 10000) / (now - windowStart)) / 10,
      drawMs: Math.round((windowFrames ? windowDrawMs / windowFrames : 0) * 10) / 10,
      engine: isFirefox ? 'gecko' : 'other',
      fg: Math.round((windowFgN ? windowFg / windowFgN : 0) * 1000) / 10,
      fps: Math.round(fps * 10) / 10,
      tier,
      matte: tune.matte,
      polish,
      blur: `${nativeBlur ? 'filter' : 'fallback'} ${blurSource.width}×${blurSource.height}`,
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
    windowSegMs = 0
    windowSegs = 0
    windowDrawMs = 0
    windowFg = 0
    windowFgN = 0
  }

  const segment = (now: number) => {
    segCtx.drawImage(video, 0, 0, segIn.width, segIn.height)
    const t0 = performance.now()
    try {
      seg.segmentForVideo(segIn, now, (result) => {
        const mask = result.confidenceMasks?.[0]
        if (mask) takeMask(mask.getAsFloat32Array(), mask.width, mask.height)
      })
      errors = 0
    } catch {
      if (++errors >= 3) giveUp('Background effects stopped working')
    }
    windowSegMs += performance.now() - t0
    windowSegs++
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
    const stale = failed || !maskAt || now - maskAt > STALE_MS
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
      if (hasRvfc) video.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
      stream.getTracks().forEach((track) => track.stop())
      video.srcObject = null
    },
  }
}
