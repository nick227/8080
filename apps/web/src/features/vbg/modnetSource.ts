import { fetchBytes, hasWebGpu, loadOrt, speedGate, toChw, warmMs } from './ort'
import type { MaskSource } from './types'

// MODNet portrait matting (Apache-2.0 — code, models and demos, official ZHKKKe/MODNet;
// ONNX conversion Xenova/modnet, Apache-2.0; notice in public/models/MODNET-NOTICE.txt).
// Real fractional alpha (hair, fingers) instead of a person/not-person score. WebGPU
// only: on CPU (WASM) it measured 360–570 ms per frame, and ORT's WebGL backend can't run
// it (int64). Without WebGPU, or if too slow, the pipeline falls back to MediaPipe.

const MODEL = __VBG_ASSETS__.modnet
const MAX_WARM_MS = 40 // ≥ ~24 masks/s, the pipeline's cadence target

const size = (fw: number, fh: number) => {
  // 512 wide, height to the frame's aspect; both multiples of 32 (16:9 → 512×288).
  const width = 512
  const height = Math.max(32, Math.round((width * fh) / fw / 32) * 32)
  return { width, height }
}

const RUNTIME = `${__VBG_ASSETS__.ort}ort-wasm-simd-threaded.asyncify.wasm`

export async function createModnetSource(onProgress?: (pct: number) => void): Promise<MaskSource> {
  if (!(await hasWebGpu())) throw new Error('no WebGPU adapter')
  // Model and runtime fetched here with progress, then handed to ORT (no second fetch).
  const got = { model: [0, 0], runtime: [0, 0] }
  const report = () => {
    const loaded = got.model[0]! + got.runtime[0]!
    const total = got.model[1]! + got.runtime[1]!
    if (total) onProgress?.(Math.min(99, Math.round((loaded / total) * 100)))
  }
  const [model, runtime] = await Promise.all([
    fetchBytes(MODEL, (l, t) => { got.model = [l, t]; report() }),
    fetchBytes(RUNTIME, (l, t) => { got.runtime = [l, t]; report() }),
  ])
  const ort = await loadOrt()
  ort.env.wasm.wasmBinary = runtime.buffer as ArrayBuffer
  const session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' })
  const inputName = session.inputNames[0]!
  const outputName = session.outputNames[0]!

  const infer = async (input: HTMLCanvasElement) => {
    const { width, height } = input
    // MODNet preprocessing: rescale to 0–1, normalise with mean 0.5 / std 0.5.
    const tensor = new ort.Tensor('float32', toChw(input, 2 / 255, -1), [1, 3, height, width])
    const result = await session.run({ [inputName]: tensor })
    const out = result[outputName]!
    const data = out.data as Float32Array
    tensor.dispose()
    return { data: data instanceof Float32Array ? data : Float32Array.from(data as ArrayLike<number>), width, height }
  }

  const probe = document.createElement('canvas')
  Object.assign(probe, size(16, 9))
  const ms = await warmMs(() => infer(probe), 4, speedGate() ? MAX_WARM_MS : Infinity)
  if (ms > MAX_WARM_MS && speedGate()) throw new Error(`too slow (${Math.round(ms)} ms)`)

  return {
    backend: 'modnet/webgpu',
    sync: false,
    // MODNet's edge noise is slower and larger (a pixel or more, several frames): a short
    // temporal filter can't remove it without lag. Measured: still −15%, slow lag +3%.
    stabilizer: { floor: 0.8, threshold: 0.5 },
    inputSize: size,
    run: (input) => infer(input),
  }
}
