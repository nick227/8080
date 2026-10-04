// The virtual-background pipeline's stages (doc/07): camera frame → mask source →
// temporal stabilizer → compositor. Mask sources are interchangeable behind this.

/** Person alpha in 0–1, row-major, at the source's own resolution. */
export type MaskFrame = { data: Float32Array; width: number; height: number }

export interface MaskSource {
  /** Which engine and execution backend produced the masks, e.g. 'modnet/webgpu'. */
  readonly backend: string
  /** Inference runs on the main thread (counts against the frame budget). */
  readonly sync: boolean
  /** The input size this source wants for a camera frame of frameW×frameH. */
  inputSize(frameW: number, frameH: number): { width: number; height: number }
  /** Segments `input` (already resized to inputSize). */
  run(input: HTMLCanvasElement, timestampMs: number): Promise<MaskFrame | null>
}

export const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}
