import fs from 'fs'
import path from 'path'
import { chromium } from '@playwright/test'

const diagPath = '/mnt/c/Users/Administrator/Downloads/vbg-synchronized-frame.json'
const diagData = JSON.parse(fs.readFileSync(diagPath, 'utf8'))

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox']
})
const page = await browser.newPage()
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

  const origCanvas = document.createElement('canvas')
  origCanvas.width = W
  origCanvas.height = H
  const ctx = origCanvas.getContext('2d')
  ctx.drawImage(img, 0, 0, W, H)
  const imgData = ctx.getImageData(0, 0, W, H)

  // Ground-truth head annotation polygon
  const headPolyCanvas = document.createElement('canvas')
  headPolyCanvas.width = W
  headPolyCanvas.height = H
  const hCtx = headPolyCanvas.getContext('2d')
  hCtx.fillStyle = '#000000'
  hCtx.fillRect(0, 0, W, H)
  hCtx.fillStyle = '#ffffff'
  hCtx.beginPath()
  
  const headPoints = [
    [185, 12], [200, 12], [212, 16], [222, 23], [228, 30],
    [233, 40], [236, 50], [236, 65], [232, 78], [225, 88],
    [215, 96], [205, 102], [192, 104], [178, 102], [168, 96],
    [158, 88], [150, 78], [147, 65], [147, 50], [150, 40],
    [156, 30], [162, 23], [172, 16]
  ]
  hCtx.moveTo(headPoints[0][0], headPoints[0][1])
  for (let i = 1; i < headPoints.length; i++) {
    hCtx.lineTo(headPoints[i][0], headPoints[i][1])
  }
  hCtx.closePath()
  hCtx.fill()

  const headPolyData = hCtx.getImageData(0, 0, W, H).data
  const perPixelHeadMask = new Uint8Array(W * H)
  let perPixelHeadTotal = 0
  for (let i = 0; i < W * H; i++) {
    if (headPolyData[i * 4] > 128) {
      perPixelHeadMask[i] = 1
      perPixelHeadTotal++
    }
  }

  // Pre-generate Gamma LUTs
  const lut05 = new Uint8Array(256)
  const lut07 = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    const norm = i / 255
    lut05[i] = Math.min(255, Math.max(0, Math.round(Math.pow(norm, 0.5) * 255)))
    lut07[i] = Math.min(255, Math.max(0, Math.round(Math.pow(norm, 0.7) * 255)))
  }

  const getChwTensor = (gammaMode) => {
    const pixels = new Uint8Array(imgData.data)
    if (gammaMode === 'gamma05') {
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = lut05[pixels[i]]
        pixels[i+1] = lut05[pixels[i+1]]
        pixels[i+2] = lut05[pixels[i+2]]
      }
    } else if (gammaMode === 'gamma07') {
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = lut07[pixels[i]]
        pixels[i+1] = lut07[pixels[i+1]]
        pixels[i+2] = lut07[pixels[i+2]]
      }
    }

    const chw = new Float32Array(3 * W * H)
    const planeSize = W * H
    for (let i = 0; i < planeSize; i++) {
      const r = pixels[i * 4]
      const g = pixels[i * 4 + 1]
      const b = pixels[i * 4 + 2]
      chw[i] = (r * 2 / 255) - 1.0
      chw[planeSize + i] = (g * 2 / 255) - 1.0
      chw[planeSize * 2 + i] = (b * 2 / 255) - 1.0
    }
    return chw
  }

  const { loadOrt } = await import('/src/features/vbg/ort.ts')
  const ort = await loadOrt()
  const session = await ort.InferenceSession.create('/models/modnet.onnx', { executionProviders: ['wasm'] })
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]

  const runInference = async (chw) => {
    const tensor = new ort.Tensor('float32', chw, [1, 3, 224, 384])
    const res = await session.run({ [inputName]: tensor })
    const data = res[outputName].data
    tensor.dispose()
    return data
  }

  const baseAlpha = await runInference(getChwTensor('none'))
  const g05Alpha = await runInference(getChwTensor('gamma05'))
  const g07Alpha = await runInference(getChwTensor('gamma07'))

  session.release()

  const calcHeadRetention = (alpha) => {
    let fg = 0
    for (let i = 0; i < W * H; i++) {
      if (perPixelHeadMask[i] === 1 && alpha[i] >= 0.5) fg++
    }
    return {
      retained: fg,
      erased: perPixelHeadTotal - fg,
      retentionPct: (fg / perPixelHeadTotal) * 100
    }
  }

  return {
    perPixelHeadTotal,
    baseline: calcHeadRetention(baseAlpha),
    gamma05: calcHeadRetention(g05Alpha),
    gamma07: calcHeadRetention(g07Alpha),
  }
}, diagData)

console.log('\n============================================================')
console.log(' GROUND-TRUTH PER-PIXEL HEAD RETENTION COMPARISON')
console.log('============================================================')
console.log('Ground-Truth Head Area: ' + results.perPixelHeadTotal + ' pixels (Exact Head Polygon)')
console.log('1. MODNet Baseline:   ' + results.baseline.retentionPct.toFixed(2) + '% retention (' + results.baseline.retained + ' retained / ' + results.baseline.erased + ' erased)')
console.log('2. MODNet + Gamma 0.7: ' + results.gamma07.retentionPct.toFixed(2) + '% retention (' + results.gamma07.retained + ' retained / ' + results.gamma07.erased + ' erased)')
console.log('3. MODNet + Gamma 0.5: ' + results.gamma05.retentionPct.toFixed(2) + '% retention (' + results.gamma05.retained + ' retained / ' + results.gamma05.erased + ' erased)')

await browser.close()
