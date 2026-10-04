// ONNX Runtime Web (MIT), self-hosted: its WASM binaries are served from /ort/ (the
// 'ort-runtime' Vite plugin) — no CDN at runtime. Loaded on first use only.
// WebGPU only: ORT's WebGL backend can't run MODNet ("int64 is not supported").
export type Ort = typeof import('onnxruntime-web/webgpu')

export async function hasWebGpu() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  return !!(await gpu?.requestAdapter().catch(() => null))
}

export async function loadOrt(): Promise<Ort> {
  const ort = await import('onnxruntime-web/webgpu')
  ort.env.wasm.wasmPaths = '/ort/'
  ort.env.wasm.numThreads = 1 // no cross-origin isolation, so no SharedArrayBuffer threads
  return ort
}

/** RGBA pixels of `input` → planar CHW float32, value·scale + bias. */
export function toChw(input: HTMLCanvasElement, scale: number, bias: number) {
  const { width: w, height: h } = input
  const px = input.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const out = new Float32Array(3 * w * h)
  const plane = w * h
  for (let i = 0; i < plane; i++) {
    out[i] = px[i * 4]! * scale + bias
    out[plane + i] = px[i * 4 + 1]! * scale + bias
    out[2 * plane + i] = px[i * 4 + 2]! * scale + bias
  }
  return out
}

/** Median warm inference time; a source too slow for live use is rejected at load.
 *  Stops after one timed run when that's already far over `limitMs` (a weak GPU would
 *  otherwise spend many slow runs before falling back). */
export async function warmMs(run: () => Promise<unknown>, runs = 4, limitMs = Infinity) {
  await run() // first run compiles kernels
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    await run()
    times.push(performance.now() - t)
    if (times[0]! > limitMs * 3) break
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length / 2)]!
}

/** Dev-only evaluation aid: localStorage['8080.vbg-nogate'] = '1' skips the speed gate,
 *  so mask quality can be compared on a machine too slow to pass it. Compiled out of
 *  production (import.meta.env.DEV). */
export const speedGate = () => {
  if (!import.meta.env.DEV) return true
  try { return localStorage.getItem('8080.vbg-nogate') !== '1' } catch { return true }
}

/** Fetches `url` reporting bytes as they arrive (for a combined progress figure). */
export async function fetchBytes(url: string, onBytes: (loaded: number, total: number) => void) {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`)
  const total = Number(response.headers.get('Content-Length')) || 0
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onBytes(loaded, total)
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
