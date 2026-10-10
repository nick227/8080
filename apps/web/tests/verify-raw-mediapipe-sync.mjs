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
    '--enable-unsafe-swiftshader',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ]
})

const context = await browser.newContext({ permissions: ['camera'] })
const page = await context.newPage()
page.on('console', msg => console.log('PAGE LOG:', msg.text()))
page.on('pageerror', err => console.error('PAGE ERROR:', err.message))

await page.addInitScript(() => {
  try {
    localStorage.setItem('8080.vbg-source', 'mediapipe')
    localStorage.setItem('8080.vbg-debug', '1')
    localStorage.setItem('8080.vbg-bypass-stabilizer', '1')
  } catch {}
})

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

  const inputCanvas = document.createElement('canvas')
  inputCanvas.width = 640
  inputCanvas.height = 360
  const ctx = inputCanvas.getContext('2d')
  ctx.drawImage(img, 0, 0, 640, 360)

  const mp = await import('/src/features/vbg/mediapipeSource.ts')
  const mpSource = await mp.createMediapipeSource()

  const rawMask = await mpSource.run(inputCanvas, Date.now())

  // Draw raw MediaPipe alpha onto canvas
  const alphaCanvas = document.createElement('canvas')
  alphaCanvas.width = W
  alphaCanvas.height = H
  const aCtx = alphaCanvas.getContext('2d')
  const aData = aCtx.createImageData(W, H)
  
  if (rawMask) {
    const rawData = rawMask.data
    const rW = rawMask.width
    const rH = rawMask.height
    
    // Rescale if necessary
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const rx = Math.floor((x / W) * rW)
        const ry = Math.floor((y / H) * rH)
        const val = Math.round((rawData[ry * rW + rx] || 0) * 255)
        const idx = (y * W + x) * 4
        aData.data[idx] = val
        aData.data[idx + 1] = val
        aData.data[idx + 2] = val
        aData.data[idx + 3] = 255
      }
    }
  }
  aCtx.putImageData(aData, 0, 0)

  // Composite raw alpha with original frame
  const compCanvas = document.createElement('canvas')
  compCanvas.width = W * 2
  compCanvas.height = H
  const cCtx = compCanvas.getContext('2d')

  const origCanvas = document.createElement('canvas')
  origCanvas.width = W
  origCanvas.height = H
  const oCtx = origCanvas.getContext('2d')
  oCtx.drawImage(img, 0, 0, W, H)

  cCtx.drawImage(origCanvas, 0, 0)
  cCtx.fillStyle = '#00ffcc'
  cCtx.font = '14px sans-serif'
  cCtx.fillText('1. Original Camera Input', 10, 20)

  cCtx.drawImage(alphaCanvas, W, 0)
  cCtx.fillText('2. Raw MediaPipe Alpha (No Stabilizer)', W + 10, 20)

  mpSource.dispose()

  return {
    rawMaskWidth: rawMask ? rawMask.width : 0,
    rawMaskHeight: rawMask ? rawMask.height : 0,
    compositeUrl: compCanvas.toDataURL('image/png')
  }
}, diagData)

fs.writeFileSync(
  path.join(outDir, 'raw-mediapipe-composite.png'),
  Buffer.from(results.compositeUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
)

console.log('\n============================================================')
console.log(' RAW MEDIAPIPE COMPOSITE AUDIT')
console.log('============================================================')
console.log('Raw Mask Dimensions:', results.rawMaskWidth + ' x ' + results.rawMaskHeight)
console.log('Saved raw MediaPipe composite snapshot to docs/validation/raw-mediapipe-composite.png')

await browser.close()
