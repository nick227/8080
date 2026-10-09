import type { MaskFrame, MaskSource } from './types'

// MediaPipe selfie_segmenter (Apache-2.0): the fallback mask source. Tiny (250 KB),
// CPU (XNNPACK) everywhere — measured 7–8 ms per mask in Chromium and Firefox.
// Synchronous: it runs on the main thread inside the frame budget.
export async function createMediapipeSource(): Promise<MaskSource> {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(__VBG_ASSETS__.mediapipe)
  const segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite', delegate: 'CPU' },
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  })

  const runSync = (input: HTMLCanvasElement, ts: number): MaskFrame | null => {
    let frame: MaskFrame | null = null
    segmenter.segmentForVideo(input, ts, (result) => {
      const mask = result.confidenceMasks?.[0]
      if (mask) frame = { data: Float32Array.from(mask.getAsFloat32Array()), width: mask.width, height: mask.height }
    })
    return frame
  }

  return {
    backend: 'mediapipe/cpu',
    model: 'selfie-segmenter',
    gpuReadbacksPerMask: 0,
    dispose: () => segmenter.close(),
    sync: true,
    // Measured (48 noisy frames): still-edge noise −66%, slow-motion lag +3%.
    stabilizer: { floor: 1, keep: 0.85 },
    inputSize: (fw, fh) => {
      const width = Math.min(384, fw)
      return { width, height: Math.max(2, Math.round((width * fh) / fw)) }
    },
    runSync,
    run: (input, ts) => Promise.resolve(runSync(input, ts)),
  }
}
