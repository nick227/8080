import { DEFAULT_TUNING, smoothstep, type MaskFrame, type StabilizerTuning } from './types'

// Foreground is acquired quickly, but needs sustained weak evidence before removal.
// Protection is bounded in elapsed time, so low inference rates cannot freeze a ghost.
// The upper part of the previous silhouette gets extra grace for hair/head dropouts.

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
  let weakMs: Float32Array | null = null
  let expanded: Float32Array | null = null
  let previousArea = 0
  let areaDelta = 0
  let headRetained = 100
  let headWeakMs = 0
  let hasPreviousAlpha = false
  let alphaImage: ImageData | null = null
  let ringImage: ImageData | null = null
  let at = 0
  // Window metrics: share of person pixels, and edge flicker (mean |Δalpha| between
  // consecutive masks over pixels that are edge in either, 0–1).
  let fgSum = 0
  let flickerSum = 0
  let flickerN = 0
  let masks = 0

  let smoothTop = 0
  let smoothBottom = 0

  const resize = (mask: MaskFrame) => {
    w = mask.width
    h = mask.height
    smoothTop = 0
    smoothBottom = 0
    const seed = lastMask && lastMask.w === w && lastMask.h === h && performance.now() - lastMask.at < 1000 ? lastMask.data : null
    smooth = seed ? Float32Array.from(seed) : Float32Array.from(mask.data)
    shaped = new Float32Array(w * h)
    held = new Uint8Array(w * h)
    weakMs = new Float32Array(w * h)
    expanded = new Float32Array(w * h)
    previousArea = 0
    for (let i = 0; i < smooth.length; i++) held[i] = smooth[i]! >= 0.65 ? 1 : 0
    hasPreviousAlpha = false
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
    const now = performance.now()
    const dt = at ? Math.max(1, now - at) : 1000 / 30
    // Derive headroom from both held pixels and raw input so flickering head pixels never collapse top downwards.
    let rawTop = h, rawBottom = 0
    for (let y = 0; y < h; y++) {
      let count = 0
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (hd[i] || raw[i]! >= 0.15) count++
      }
      if (count >= Math.max(2, w * 0.02)) { rawTop = Math.min(rawTop, y); rawBottom = y }
    }
    if (rawTop < h && rawBottom > 0) {
      smoothTop = smoothTop === 0 ? rawTop : Math.min(rawTop, smoothTop + 1)
      smoothBottom = smoothBottom === 0 ? rawBottom : Math.max(rawBottom, smoothBottom - 1)
    } else {
      smoothTop = rawTop
      smoothBottom = rawBottom
    }
    const headBottom = smoothTop + Math.max(1, (smoothBottom - smoothTop + 1) * 0.45)
    let headBefore = 0, headAfter = 0
    headWeakMs = 0
    for (let i = 0; i < s.length; i++) {
      const next = Number.isFinite(raw[i]) ? Math.max(0, Math.min(1, raw[i]!)) : s[i]!
      const previous = s[i]!
      const inHead = Math.floor(i / w) >= smoothTop && Math.floor(i / w) < headBottom
      const wasHeld = hd[i] === 1
      if (inHead && wasHeld) headBefore++
      weakMs![i] = wasHeld && next < 0.35 ? weakMs![i]! + dt : 0
      const weak = weakMs![i]!
      if (next >= previous) {
        const change = next - previous
        const keep = change > tuning.threshold ? 0 : tuning.keep * Math.max(tuning.floor, Math.abs(previous - 0.5) * 2)
        s[i] = next * (1 - keep) + previous * keep
      } else if (inHead && wasHeld && next >= 0.10) {
        // Retain head/hair pixels with faint raw confidence (>= 0.10) so the head never collapses down to the chin
        s[i] = Math.max(0.55, previous * 0.96)
      } else {
        // Clear background (next < 0.10) fast (tau=40ms) to prevent ghosting
        const tau = next < 0.10 ? 40 : 100
        s[i] = next + (previous - next) * Math.exp(-dt / tau)
      }
      hd[i] = s[i] >= 0.25 ? 1 : 0
      sh[i] = smoothstep(0.15, 0.65, s[i]!)
      if (inHead && wasHeld) {
        if (sh[i]! >= 0.5) headAfter++
        headWeakMs = Math.max(headWeakMs, weak)
      }
    }
    headRetained = headBefore ? headAfter / headBefore * 100 : 100
    // One mask-pixel dilation preserves hairlines and fills tiny holes. A separate
    // feather pass softens its outside edge without eroding the solid silhouette.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let peak = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        peak = Math.max(peak, sh[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))]!)
      }
      expanded![y * w + x] = peak
    }
    const px = alphaImage!.data
    const rp = ringImage!.data
    let fg = 0
    let edgeDelta = 0
    let edgeCount = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy))
          for (let dx = -1; dx <= 1; dx++) sum += expanded![yy * w + Math.min(w - 1, Math.max(0, x + dx))]!
        }
        const i = y * w + x
        const a = Math.round((sum / 9) * 255)
        // ImageData still holds the previous frame until this pixel is written.
        const previous = px[i * 4 + 3]!
        if (hasPreviousAlpha && ((a > 0 && a < 255) || (previous > 0 && previous < 255))) {
          edgeDelta += Math.abs(a - previous)
          edgeCount++
        }
        px[i * 4 + 3] = a
        rp[i * 4 + 3] = a < 5 ? 0 : Math.round((1 - smoothstep(0.6, 0.98, a / 255)) * 255)
        if (a > 127) fg++
      }
    }
    if (edgeCount) { flickerSum += edgeDelta / edgeCount / 255; flickerN++ }
    hasPreviousAlpha = true
    alphaCtx.putImageData(alphaImage!, 0, 0)
    ringCtx.putImageData(ringImage!, 0, 0)
    areaDelta = previousArea ? (fg - previousArea) / previousArea * 100 : 0
    previousArea = fg
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
      const out = { fg: masks ? (fgSum / masks) * 100 : 0, flicker: flickerN ? (flickerSum / flickerN) * 100 : 0, areaDelta, headRetained, headWeakMs }
      fgSum = 0
      flickerSum = 0
      flickerN = 0
      masks = 0
      return out
    },
  }
}
