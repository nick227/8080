import { DEFAULT_TUNING, smoothstep, type MaskFrame, type StabilizerTuning } from './types'

// Temporal stabilizer: owns everything about time. Confidence-weighted smoothing,
// hysteresis, previous-mask retention and the stale timeout, so the edge stays calm and
// favours keeping the subject over clipping it. Stable edges beat accurate edges.
//
// - Smoothing: steady pixels keep up to `keep` of their history, weighted by certainty
//   (with a per-source `floor` so edge pixels get smoothed too); a change above
//   `threshold` is motion and is followed at once (no ghost trails). Tuned per source
//   (doc/07): settings that calmed still edges were kept only if lag on a slow-motion
//   clip rose ≤ ~3%.
// - Hysteresis: a pixel becomes person above 0.5 and stops only below 0.3, so one
//   uncertain frame can't remove it. No erosion. A small (3×3) feather.
// - Retention: a new stabilizer (framing → recording) is seeded with the last mask
//   (< 1 s old), so a take starts composited. Stale after STALE_MS: the compositor shows
//   the raw camera rather than a frozen cutout.

export const STALE_MS = 500

let lastMask: { data: Float32Array; w: number; h: number; at: number } | null = null

function canvas() {
  const el = document.createElement('canvas')
  el.width = 2
  el.height = 2
  return el
}

export type Stabilizer = ReturnType<typeof createStabilizer>

export function createStabilizer(initial: Partial<StabilizerTuning> = {}) {
  let tuning: StabilizerTuning = { ...DEFAULT_TUNING, ...initial }
  const alpha = canvas() // mask resolution; alpha channel = the matte
  const ring = canvas() // the matte's edge band (for colour decontamination)
  const alphaCtx = alpha.getContext('2d')!
  const ringCtx = ring.getContext('2d')!
  let w = 0
  let h = 0
  let smooth: Float32Array | null = null
  let shaped: Float32Array | null = null
  let held: Uint8Array | null = null
  let prevAlpha: Uint8Array | null = null
  let alphaImage: ImageData | null = null
  let ringImage: ImageData | null = null
  let at = 0
  // Window metrics: share of person pixels, and edge flicker (mean |Δalpha| between
  // consecutive masks over pixels that are edge in either, 0–1).
  let fgSum = 0
  let flickerSum = 0
  let flickerN = 0
  let masks = 0

  const resize = (mask: MaskFrame) => {
    w = mask.width
    h = mask.height
    const seed = lastMask && lastMask.w === w && lastMask.h === h && performance.now() - lastMask.at < 1000 ? lastMask.data : null
    smooth = seed ? Float32Array.from(seed) : Float32Array.from(mask.data)
    shaped = new Float32Array(w * h)
    held = new Uint8Array(w * h)
    prevAlpha = null
    for (const el of [alpha, ring]) { el.width = w; el.height = h }
    alphaImage = alphaCtx.createImageData(w, h)
    ringImage = ringCtx.createImageData(w, h)
  }

  const update = (mask: MaskFrame) => {
    if (!smooth || mask.width !== w || mask.height !== h) resize(mask)
    const s = smooth!
    const sh = shaped!
    const hd = held!
    const raw = mask.data
    for (let i = 0; i < s.length; i++) {
      const next = raw[i]!
      const change = Math.abs(next - s[i]!)
      const certainty = Math.max(tuning.floor, Math.abs(s[i]! - 0.5) * 2)
      const keep = change > tuning.threshold ? 0 : tuning.keep * certainty * (1 - change / tuning.threshold)
      s[i] = next * (1 - keep) + s[i]! * keep
      if (s[i]! > 0.5) hd[i] = 1
      else if (s[i]! < 0.3) hd[i] = 0
      // Held pixels ramp in a little earlier; others need real confidence.
      sh[i] = hd[i] ? smoothstep(0.25, 0.5, s[i]!) : smoothstep(0.5, 0.8, s[i]!)
    }
    const px = alphaImage!.data
    const rp = ringImage!.data
    const next = new Uint8Array(w * h)
    let fg = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy))
          for (let dx = -1; dx <= 1; dx++) sum += sh[yy * w + Math.min(w - 1, Math.max(0, x + dx))]!
        }
        const i = y * w + x
        const a = Math.round((sum / 9) * 255)
        px[i * 4 + 3] = a
        rp[i * 4 + 3] = a < 5 ? 0 : Math.round((1 - smoothstep(0.6, 0.98, a / 255)) * 255)
        next[i] = a
        if (a > 127) fg++
      }
    }
    if (prevAlpha) {
      let sum = 0
      let n = 0
      for (let i = 0; i < next.length; i++) {
        const a = next[i]!
        const b = prevAlpha[i]!
        if ((a > 0 && a < 255) || (b > 0 && b < 255)) { sum += Math.abs(a - b); n++ }
      }
      if (n) { flickerSum += sum / n / 255; flickerN++ }
    }
    prevAlpha = next
    alphaCtx.putImageData(alphaImage!, 0, 0)
    ringCtx.putImageData(ringImage!, 0, 0)
    fgSum += fg / (w * h)
    masks++
    at = performance.now()
    lastMask = { data: s, w, h, at }
  }

  return {
    update,
    /** A different source took over (framing upgrade): use its tuning from now on. */
    setTuning: (next: Partial<StabilizerTuning> = {}) => { tuning = { ...DEFAULT_TUNING, ...next } },
    alpha,
    ring,
    /** Smoothed + shaped person confidence at mask resolution (for brightness matching). */
    confidence: () => shaped,
    size: () => ({ width: w, height: h }),
    /** A mask fresh enough to composite with. */
    usable: (now: number) => at > 0 && now - at <= STALE_MS,
    /** Window metrics since the last call (person %, flicker %). */
    takeStats: () => {
      const out = { fg: masks ? (fgSum / masks) * 100 : 0, flicker: flickerN ? (flickerSum / flickerN) * 100 : 0 }
      fgSum = 0
      flickerSum = 0
      flickerN = 0
      masks = 0
      return out
    },
  }
}
