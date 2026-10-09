import type { MaskFrame, MaskSource } from './types'

// MediaPipe selfie_multiclass_256x256: Predicts 6 categories:
// 0: background, 1: hair, 2: body-skin, 3: face-skin, 4: clothes, 5: accessories
// Combining categories 1–5 (or 1 - background) extracts the complete person:
// face, hair, headphones, shirt, shoulders, and arms.
export async function createMediapipeMulticlassSource(useGpu = true): Promise<MaskSource> {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(__VBG_ASSETS__.mediapipe)
  let activeDelegate: 'GPU' | 'CPU' = useGpu ? 'GPU' : 'CPU'
  let segmenter: Awaited<ReturnType<typeof ImageSegmenter.createFromOptions>>
  try {
    segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/selfie_multiclass_256x256.tflite', delegate: activeDelegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    })
  } catch {
    activeDelegate = 'CPU'
    segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/selfie_multiclass_256x256.tflite', delegate: 'CPU' },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    })
  }

  const runSync = (input: HTMLCanvasElement, ts: number): MaskFrame | null => {
    let frame: MaskFrame | null = null
    segmenter.segmentForVideo(input, ts, (result: any) => {
      const masks = result.confidenceMasks
      if (masks && masks.length > 0) {
        const bgMask = masks[0]!
        const bgData = bgMask.getAsFloat32Array()
        const len = bgData.length
        const data = new Float32Array(len)
        // 1.0 - background confidence = complete person confidence (hair + face + skin + clothes + accessories)
        for (let i = 0; i < len; i++) {
          data[i] = Math.max(0, Math.min(1, 1.0 - bgData[i]!))
        }
        frame = { data, width: bgMask.width, height: bgMask.height }
      }
    })
    return frame
  }

  return {
    backend: `mediapipe/${activeDelegate.toLowerCase()}`,
    model: 'selfie-multiclass',
    gpuReadbacksPerMask: activeDelegate === 'GPU' ? 1 : 0,
    dispose: () => segmenter.close(),
    sync: activeDelegate === 'CPU',
    stabilizer: { floor: 1, keep: 0.85 },
    inputSize: (fw, fh) => {
      const width = Math.min(256, fw)
      return { width, height: Math.max(2, Math.round((width * fh) / fw)) }
    },
    runSync: activeDelegate === 'CPU' ? runSync : undefined,
    run: (input, ts) => {
      const res = runSync(input, ts)
      return Promise.resolve(res ?? { data: new Float32Array(0), width: 0, height: 0 })
    },
  }
}
