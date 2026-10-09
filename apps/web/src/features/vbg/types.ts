// The virtual-background pipeline's stages (doc/07): camera frame → mask source →
// temporal stabilizer → compositor. Mask sources are interchangeable behind this.

/** Person alpha in 0–1, row-major, at the source's own resolution. */
export type MaskFrame = { data: Float32Array; width: number; height: number }

export interface MaskSource {
  /** Which engine and execution backend produced the masks, e.g. 'modnet/webgpu'. */
  readonly backend: string
  /** Model identity supplied by its loader, independent of execution provider. */
  readonly model?: string
  /** Explicitly known output transfers only; omitted means unmeasured. */
  readonly gpuReadbacksPerMask?: number
  /** Inference runs on the main thread (counts against the frame budget). */
  readonly sync: boolean
  /** The input size this source wants for a camera frame of frameW×frameH. */
  inputSize(frameW: number, frameH: number): { width: number; height: number }
  /** Optional synchronous segmenter call for CPU sources to enable same-frame mask application. */
  runSync?(input: HTMLCanvasElement, timestampMs: number): MaskFrame | null
  /** Segments input (already resized to inputSize). */
  run(input: HTMLCanvasElement, timestampMs: number): Promise<MaskFrame | null>
  /** Per-source stabilizer tuning (each engine's noise is different). */
  dispose?(): void | Promise<void>
  diagnostics?(): string
  readonly stabilizer?: Partial<StabilizerTuning>
}

/**
 * - threshold: foreground growth above this is followed immediately.
 * - keep: the most history a steady pixel keeps.
 * - floor: the minimum certainty used for smoothing. Edge pixels sit near 0.5 confidence
 *   (certainty ≈ 0), so with no floor the edge — where flicker lives — is never smoothed.
 */
export type StabilizerTuning = { threshold: number; keep: number; floor: number }
export const DEFAULT_TUNING: StabilizerTuning = { threshold: 0.25, keep: 0.75, floor: 0 }

export const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}
