import { hasWebGpu, loadOrt, toChw, warmMs } from './ort'
import type { MaskSource } from './types'

// EVALUATION ONLY — never in production. Robust Video Matting (PeterL1n/
// RobustVideoMatting) is GPL-3.0. It is the benchmark for "is recurrent matting worth
// it": the model carries temporal state (r1–r4) from frame to frame.
//
// Kept out of production at build time: this module is only reachable through an
// `import.meta.env.DEV` branch (maskSource.ts), so Vite drops it from production
// bundles, and its weights are served only by the dev server from apps/web/.dev-models/
// (gitignored, never emitted). No code here is shared with MODNet or the stabilizer.
// Build-time exclusion is hygiene, not a legal safe harbour: don't distribute a build
// containing this without legal review.

const WEIGHTS = '/__dev-models/rvm_mobilenetv3_fp32.onnx'
const DOWNSAMPLE = 0.5 // base network at half the input; RVM's refiner restores full size

const size = (fw: number, fh: number) => {
  const width = 640
  return { width, height: Math.round((width * fh) / fw / 2) * 2 }
}

export async function createRvmSource(): Promise<MaskSource> {
  if (!(await hasWebGpu())) throw new Error('no WebGPU adapter')
  const ort = await loadOrt()
  const session = await ort.InferenceSession.create(WEIGHTS, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' })
  const zero = () => new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1])
  let state: InstanceType<typeof ort.Tensor>[] = [zero(), zero(), zero(), zero()]
  const ratio = new ort.Tensor('float32', new Float32Array([DOWNSAMPLE]), [1])

  const infer = async (input: HTMLCanvasElement) => {
    const { width, height } = input
    const src = new ort.Tensor('float32', toChw(input, 1 / 255, 0), [1, 3, height, width])
    const out = await session.run({ src, r1i: state[0]!, r2i: state[1]!, r3i: state[2]!, r4i: state[3]!, downsample_ratio: ratio })
    src.dispose()
    state = [out.r1o!, out.r2o!, out.r3o!, out.r4o!]
    out.fgr?.dispose()
    return { data: Float32Array.from(out.pha!.data as Float32Array), width, height }
  }

  const probe = document.createElement('canvas')
  Object.assign(probe, size(16, 9))
  await warmMs(() => infer(probe), 2)
  state = [zero(), zero(), zero(), zero()] // don't carry the probe's state into real frames

  return { backend: 'rvm-dev/webgpu', sync: false, inputSize: size, run: (input) => infer(input) }
}
