import fs from 'fs'
import path from 'path'
import { chromium } from '@playwright/test'

const diagPath = '/mnt/c/Users/Administrator/Downloads/vbg-synchronized-frame.json'
const outDir = path.resolve(process.cwd(), 'docs/validation')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

const diagData = JSON.parse(fs.readFileSync(diagPath, 'utf8'))

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer',
    '--use-webgpu-adapter=swiftshader',
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ]
})

const page = await browser.newPage()
page.on('console', msg => console.log('BROWSER LOG:', msg.text()))
page.on('pageerror', err => console.error('BROWSER ERR:', err.message))

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })

const results = await page.evaluate(async (data) => {
  const W = 384
  const H = 224

  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
    img.src = data.original || data.inferenceInput
  })

  // Create source canvas
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, W, H)

  // 1. Raw MODNet Alpha from captured diagnostic
  const modnetAlpha = new Float32Array(data.rawAlpha)

  // 2. Run MediaPipe Selfie Segmenter
  let mediapipeAlpha = new Float32Array(W * H)
  try {
    const mp = await import('/src/features/vbg/mediapipeSource.ts')
    const mpSource = await mp.createMediapipeSource()
    const res = await mpSource.run(canvas, Date.now())
    if (res && res.data) {
      if (res.width === W && res.height === H) {
        mediapipeAlpha = res.data
      } else {
        const mpCanvas = document.createElement('canvas')
        mpCanvas.width = res.width
        mpCanvas.height = res.height
        const mpCtx = mpCanvas.getContext('2d')
        const mpImgData = mpCtx.createImageData(res.width, res.height)
        for (let i = 0; i < res.data.length; i++) {
          const v = Math.round(res.data[i] * 255)
          mpImgData.data[i * 4] = v
          mpImgData.data[i * 4 + 1] = v
          mpImgData.data[i * 4 + 2] = v
          mpImgData.data[i * 4 + 3] = 255
        }
        mpCtx.putImageData(mpImgData, 0, 0)

        const resizeCanvas = document.createElement('canvas')
        resizeCanvas.width = W
        resizeCanvas.height = H
        const rCtx = resizeCanvas.getContext('2d')
        rCtx.drawImage(mpCanvas, 0, 0, W, H)
        const rData = rCtx.getImageData(0, 0, W, H).data
        for (let i = 0; i < W * H; i++) {
          mediapipeAlpha[i] = rData[i * 4] / 255
        }
      }
    }
    mpSource.dispose()
  } catch (err) {
    console.error('MediaPipe run error:', err)
  }

  // 3. Run RVM (Robust Video Matting) with WebGPU or WASM fallback
  let rvmAlpha = new Float32Array(W * H)
  try {
    const { loadOrt, toChw } = await import('/src/features/vbg/ort.ts')
    const ort = await loadOrt()
    const WEIGHTS = '/__dev-models/rvm_mobilenetv3_fp32.onnx'
    
    let ep = ['webgpu']
    if (!navigator.gpu) ep = ['wasm']
    
    let session
    try {
      session = await ort.InferenceSession.create(WEIGHTS, { executionProviders: ep, graphOptimizationLevel: 'all' })
    } catch {
      session = await ort.InferenceSession.create(WEIGHTS, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    }

    const zero = () => new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1])
    let state = [zero(), zero(), zero(), zero()]
    const ratio = new ort.Tensor('float32', new Float32Array([0.5]), [1])

    const src = new ort.Tensor('float32', toChw(canvas, 1 / 255, 0), [1, 3, H, W])
    const out = await session.run({ src, r1i: state[0], r2i: state[1], r3i: state[2], r4i: state[3], downsample_ratio: ratio })
    
    src.dispose()
    state.forEach(t => t.dispose())
    ratio.dispose()
    out.fgr?.dispose()
    out.r1o?.dispose()
    out.r2o?.dispose()
    out.r3o?.dispose()
    out.r4o?.dispose()

    const rawData = out.pha.data
    const phaWidth = out.pha.dims[3]
    const phaHeight = out.pha.dims[2]

    if (phaWidth === W && phaHeight === H) {
      rvmAlpha = Float32Array.from(rawData)
    } else {
      const rvmCanvas = document.createElement('canvas')
      rvmCanvas.width = phaWidth
      rvmCanvas.height = phaHeight
      const rCtx = rvmCanvas.getContext('2d')
      const rImgData = rCtx.createImageData(phaWidth, phaHeight)
      for (let i = 0; i < rawData.length; i++) {
        const v = Math.round(rawData[i] * 255)
        rImgData.data[i * 4] = v
        rImgData.data[i * 4 + 1] = v
        rImgData.data[i * 4 + 2] = v
        rImgData.data[i * 4 + 3] = 255
      }
      rCtx.putImageData(rImgData, 0, 0)

      const resizeCanvas = document.createElement('canvas')
      resizeCanvas.width = W
      resizeCanvas.height = H
      const r2Ctx = resizeCanvas.getContext('2d')
      r2Ctx.drawImage(rvmCanvas, 0, 0, W, H)
      const r2Data = r2Ctx.getImageData(0, 0, W, H).data
      for (let i = 0; i < W * H; i++) {
        rvmAlpha[i] = r2Data[i * 4] / 255
      }
    }
    out.pha.dispose()
    await session.release()
  } catch (err) {
    console.error('RVM run error:', err)
  }

  // Targeted Sampling Points:
  const samplePoints = [
    { label: 'Inner Forehead (192, 60)', x: 192, y: 60, target: 'Definite Foreground' },
    { label: 'Nose Center (192, 75)',    x: 192, y: 75, target: 'Definite Foreground' },
    { label: 'Headphone Cup (150, 65)', x: 150, y: 65, target: 'Definite Foreground' },
    { label: 'Jaw / Chin (192, 95)',     x: 192, y: 95, target: 'Definite Foreground' },
    { label: 'Left Room BG (30, 50)',   x: 30,  y: 50, target: 'Definite Background' },
    { label: 'Right Room BG (350, 50)', x: 350, y: 50, target: 'Definite Background' },
  ]

  const getVal = (arr, x, y) => arr[y * W + x]

  const pointResults = samplePoints.map(pt => ({
    ...pt,
    modnet: getVal(modnetAlpha, pt.x, pt.y),
    mediapipe: getVal(mediapipeAlpha, pt.x, pt.y),
    rvm: getVal(rvmAlpha, pt.x, pt.y),
  }))

  const compCanvas = document.createElement('canvas')
  compCanvas.width = W * 4
  compCanvas.height = H
  const cCtx = compCanvas.getContext('2d')

  // Panel 1: Original
  cCtx.drawImage(canvas, 0, 0)
  cCtx.fillStyle = '#00ffcc'
  cCtx.font = '14px sans-serif'
  cCtx.fillText('1. Original Input', 10, 20)

  const renderAlphaPanel = (alphaArr, offsetX, label) => {
    const aCanvas = document.createElement('canvas')
    aCanvas.width = W
    aCanvas.height = H
    const aCtx = aCanvas.getContext('2d')
    const aData = aCtx.createImageData(W, H)
    for (let i = 0; i < W * H; i++) {
      const v = Math.round(alphaArr[i] * 255)
      aData.data[i * 4] = v
      aData.data[i * 4 + 1] = v
      aData.data[i * 4 + 2] = v
      aData.data[i * 4 + 3] = 255
    }
    aCtx.putImageData(aData, 0, 0)
    cCtx.drawImage(aCanvas, offsetX, 0)

    cCtx.fillStyle = '#00ffcc'
    cCtx.font = '14px sans-serif'
    cCtx.fillText(label, offsetX + 10, 20)
  }

  renderAlphaPanel(modnetAlpha, W, '2. MODNet FP32 (Raw Alpha)')
  renderAlphaPanel(mediapipeAlpha, W * 2, '3. MediaPipe Selfie (Raw Alpha)')
  renderAlphaPanel(rvmAlpha, W * 3, '4. RVM MobileNetV3 (Raw Alpha)')

  pointResults.forEach(pt => {
    const isFg = pt.target === 'Definite Foreground'
    const color = isFg ? '#00ff00' : '#ff0000'
    for (let col = 0; col < 4; col++) {
      const px = col * W + pt.x
      const py = pt.y
      cCtx.strokeStyle = color
      cCtx.lineWidth = 1.5
      cCtx.beginPath()
      cCtx.arc(px, py, 4, 0, 2 * Math.PI)
      cCtx.stroke()
    }
  })

  return {
    pointResults,
    compositeUrl: compCanvas.toDataURL('image/png'),
  }
}, diagData)

fs.writeFileSync(
  path.join(outDir, 'model-comparison-composite.png'),
  Buffer.from(results.compositeUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
)

console.log('=== TARGETED POINT ALPHA EVALUATION ===')
results.pointResults.forEach(pt => {
  console.log(pt.label + ' | Target: ' + pt.target + ' | MODNet: ' + pt.modnet.toFixed(4) + ' | MediaPipe: ' + pt.mediapipe.toFixed(4) + ' | RVM: ' + pt.rvm.toFixed(4))
})

console.log('Saved comparison composite to docs/validation/model-comparison-composite.png')
await browser.close()
