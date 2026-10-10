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

await page.addInitScript(() => {
  try {
    localStorage.setItem('8080.vbg-source', 'mediapipe')
    localStorage.setItem('8080.vbg-debug', '1')
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

  const mp = await import('/src/features/vbg/mediapipeSource.ts')
  const mpSource = await mp.createMediapipeSource()

  const syncAudit = []

  // Simulate lateral shift of head
  for (let f = 0; f < 10; f++) {
    const shiftX = f * 10
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 640, 360)
    ctx.drawImage(img, shiftX, 0, 640, 360)

    const startTs = performance.now()
    const rawMask = await mpSource.run(inputCanvas, 100 + f * 33)
    const runMs = performance.now() - startTs

    if (!rawMask) continue

    // Rescale mask coordinates from raw mask dims to 384x224
    const mW = rawMask.width
    const mH = rawMask.height
    
    // Forehead moves from (192, 60) to (192 + shiftX * 384/640, 60)
    const newForeheadX = Math.round((192 + shiftX * (384 / 640)) * (mW / 384))
    const foreheadY = Math.round(60 * (mH / 224))

    const vacatedX = Math.round(192 * (mW / 384))

    const newPosAlpha = rawMask.data[foreheadY * mW + newForeheadX] || 0
    const vacatedPosAlpha = rawMask.data[foreheadY * mW + vacatedX] || 0

    syncAudit.push({
      frame: f + 1,
      shiftX,
      runMs,
      newForeheadX,
      newPosAlpha,
      vacatedPosAlpha
    })
  }

  mpSource.dispose()
  return syncAudit
}, diagData)

console.log('\n============================================================')
console.log(' RAW MEDIAPIPE SAME-FRAME SYNCHRONIZATION TEST')
console.log('============================================================')
results.forEach(r => {
  console.log('Frame ' + r.frame + ' (Shift ' + r.shiftX + 'px) | Inference: ' + r.runMs.toFixed(1) + 'ms | New Forehead Alpha: ' + r.newPosAlpha.toFixed(4) + ' | Vacated Pos Alpha: ' + r.vacatedPosAlpha.toFixed(4))
})

await browser.close()
