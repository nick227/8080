import type { MaskFrame } from './types'

export type DiagnosticFrame = {
  frameId: number; timestampMs: number; backend: string; model: string
  inferenceMs: number; original: HTMLCanvasElement; inferenceInput: HTMLCanvasElement
  raw: MaskFrame; stabilized: HTMLCanvasElement; refined: HTMLCanvasElement
  refinementApplied: boolean; final: HTMLCanvasElement
  foregroundLayer: HTMLCanvasElement; backgroundPlate: HTMLCanvasElement
}
type Request = { resolve: (value: Blob) => void; reject: (reason: unknown) => void }
const getPending = (): Request | null => (globalThis as any).__vbgDiagnosticPending ?? null
const setPending = (req: Request | null) => { (globalThis as any).__vbgDiagnosticPending = req }

/** One-shot, local-only capture. No pixel readback/export on ordinary live frames. */
export function requestVbgDiagnostic(): Promise<Blob> {
  if (getPending()) return Promise.reject(new Error('A capture is already pending'))
  return new Promise((resolve, reject) => {
    const request: Request = {
      resolve: blob => { clearTimeout(timer); setPending(null); resolve(blob) },
      reject: error => { clearTimeout(timer); setPending(null); reject(error) },
    }
    const timer = setTimeout(() => {
      if (getPending() === request) setPending(null)
      reject(new Error('No mask captured in 15 seconds. Keep the camera and background effect running.'))
    }, 15_000)
    setPending(request)
  })
}
export function takeVbgDiagnosticRequest() {
  const request = getPending()
  setPending(null)
  return request
}

export function exportDiagnostic(frame: DiagnosticFrame): Blob {
  const { width, height, data } = frame.raw
  const rawImage = document.createElement('canvas'); rawImage.width = width; rawImage.height = height
  const ctx = rawImage.getContext('2d')!, pixels = ctx.createImageData(width, height)
  let min = Infinity, max = -Infinity, nonFinite = 0
  for (let i = 0; i < data.length; i++) {
    const value = data[i]!
    if (!Number.isFinite(value)) nonFinite++
    else { min = Math.min(min, value); max = Math.max(max, value) }
    const byte = Math.round(Math.max(0, Math.min(1, value)) * 255)
    pixels.data.set([byte, byte, byte, 255], i * 4)
  }
  ctx.putImageData(pixels, 0, 0)
  // JSON numbers preserve the Float32 values without image alpha quantization.
  // Save the exact plane so both compositors can consume the identical tensor.
  return new Blob([JSON.stringify({
    schema: 1, frameId: frame.frameId, inputTimestampMs: frame.timestampMs,
    exportedAt: new Date().toISOString(), backend: frame.backend, model: frame.model,
    renderer: 'canvas2d', outputLocation: 'cpu', dtype: 'float32', layout: 'NCHW [1,1,H,W]',
    inferenceMs: frame.inferenceMs, width, height, min, max, nonFinite,
    refinementApplied: frame.refinementApplied,
    finalAlignment: 'Same inference snapshot re-rendered by the app compositor; not a later live camera frame',
    original: frame.original.toDataURL('image/png'), inferenceInput: frame.inferenceInput.toDataURL('image/png'),
    rawAlpha: Array.from(data), rawAlphaImage: rawImage.toDataURL('image/png'),
    // These PNGs encode the matte in their alpha channel, not their RGB channels.
    stabilizedAlpha: frame.stabilized.toDataURL('image/png'), refinedAlpha: frame.refined.toDataURL('image/png'),
    foregroundLayer: frame.foregroundLayer.toDataURL('image/png'), backgroundPlate: frame.backgroundPlate.toDataURL('image/png'),
    final: frame.final.toDataURL('image/png'),
  })], { type: 'application/json' })
}
