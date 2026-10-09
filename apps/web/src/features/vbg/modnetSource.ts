import { fetchBytes, hasWebGpu, loadOrt, speedGate, toChw, warmMs } from './ort'
import type { MaskSource } from './types'

// MODNet portrait matting (Apache-2.0 — code, models and demos, official ZHKKKe/MODNet;
// ONNX conversion Xenova/modnet, Apache-2.0; notice in public/models/MODNET-NOTICE.txt).
// Real fractional alpha (hair, fingers) instead of a person/not-person score. WebGPU
// only: on CPU (WASM) it measured 360–570 ms per frame, and ORT's WebGL backend can't run
// it (int64). Without WebGPU, or if too slow, the pipeline falls back to MediaPipe.

const MODEL = __VBG_ASSETS__.modnet
const MAX_WARM_MS = 40 // ≥ ~24 masks/s, the pipeline's cadence target

const size = (fw: number, fh: number, width = 512) => {
  // 512 wide, height to the frame's aspect; both multiples of 32 (16:9 → 512×288).
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

  let inputWidth = 512
  let preprocessMs = 0
  let executeMs = 0
  const trials: string[] = []
  const infer = async (input: HTMLCanvasElement) => {
    const { width, height } = input
    // MODNet preprocessing: rescale to 0–1, normalise with mean 0.5 / std 0.5.
    const start = performance.now()
    const tensor = new ort.Tensor('float32', toChw(input, 2 / 255, -1), [1, 3, height, width])
    preprocessMs = performance.now() - start
    const runStart = performance.now()
    let result: Awaited<ReturnType<typeof session.run>> | undefined
    try {
      result = await session.run({ [inputName]: tensor })
      const out = result[outputName]!
      // Own the CPU mask before disposing ORT outputs; do not accumulate tensors.
      if (out.type !== 'float32' || out.dims.length !== 4 || out.dims[0] !== 1 || out.dims[1] !== 1 || out.dims[2] !== height || out.dims[3] !== width) {
        throw new Error(`Unexpected MODNet alpha layout: ${out.type} [${out.dims.join(',')}]`)
      }
      const values = out.data
      if (!(values instanceof Float32Array) || values.length !== width * height) throw new Error('MODNet alpha must be contiguous float32')
      const data = Float32Array.from(values)
      executeMs = performance.now() - runStart
      return { data, width, height }
    } finally {
      tensor.dispose()
      if (result) Object.values(result).forEach(output => output.dispose())
    }
  }

  const probe = document.createElement('canvas')
  // Prefer the highest resolution that meets the budget, instead of rejecting
  // the accelerated model after testing only 512 px. Shape-specific warmup stays
  // outside measurements. Timings include GPU completion/readback, not just dispatch.
  try {
    for (const width of [512, 384, 256]) {
      inputWidth = width
      Object.assign(probe, size(16, 9, width))
      const ms = await warmMs(() => infer(probe), 4, speedGate() ? MAX_WARM_MS : Infinity)
      trials.push(`${width}px ${Math.round(ms)}ms (prep ${preprocessMs.toFixed(1)}, run/readback ${executeMs.toFixed(1)})`)
      if (ms <= MAX_WARM_MS || !speedGate()) break
      if (width === 256) throw new Error(`MODNet budget exceeded: ${trials.join('; ')}`)
    }
  } catch (error) {
    await session.release()
    throw error
  }

  return {
    backend: 'modnet/webgpu',
    model: 'modnet-fp32',
    dispose: () => session.release(),
    sync: false,
    // MODNet's edge noise is slower and larger (a pixel or more, several frames): a short
    // temporal filter can't remove it without lag. Measured: still −15%, slow lag +3%.
    stabilizer: { floor: 0.8, threshold: 0.5 },
    diagnostics: () => `${inputWidth}px · prep ${preprocessMs.toFixed(1)}ms · run/readback ${executeMs.toFixed(1)}ms · warm ${trials.join("; ")}`,
    inputSize: (fw, fh) => size(fw, fh, inputWidth),
    run: (input) => infer(input),
  }
}
