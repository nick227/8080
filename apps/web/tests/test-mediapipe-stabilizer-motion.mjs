import fs from 'fs'
import path from 'path'
import { chromium } from '@playwright/test'

const diagPath = '/mnt/c/Users/Administrator/Downloads/vbg-synchronized-frame.json'
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
  const { createStabilizer } = await import('/src/features/vbg/stabilizer.ts')
  
  const mpSource = await mp.createMediapipeSource()
  const stabilizer = createStabilizer(mpSource.stabilizer || {}, true)

  const motionFrames = []

  // Simulate lateral motion of head across 15 consecutive frames
  for (let f = 0; f < 15; f++) {
    const shiftX = f * 6
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 640, 360)
    ctx.drawImage(img, shiftX, 0, 640, 360)

    const rawMask = await mpSource.run(inputCanvas, 100 + f * 33)
    if (!rawMask) continue

    const now = 100 + f * 33
    stabilizer.update(rawMask, now)
    const stabCanvas = stabilizer.alpha
    const sCtx = stabCanvas.getContext('2d')
    const sData = sCtx.getImageData(0, 0, W, H).data

    // Measure at original forehead position (x=192, y=60)
    const rawVal = rawMask.data[60 * W + 192]
    const stabVal = sData[(60 * W + 192) * 4 + 3] / 255

    motionFrames.push({
      frame: f + 1,
      shiftX,
      rawAlphaAtForehead: rawVal,
      stabAlphaAtForehead: stabVal,
      ghostLagActive: stabVal > 0.5 && rawVal < 0.2
    })
  }

  mpSource.dispose()

  return motionFrames
}, diagData)

console.log('\n============================================================')
console.log(' MEDIAPIPE MOTION & STABILIZER TRAILING GHOST AUDIT')
console.log('============================================================')
results.forEach(r => {
  const ghost = r.ghostLagActive ? 'YES (STABILIZER GHOSTING TRAIL ACTIVE!)' : 'No'
  console.log('Frame ' + r.frame + ' (Shift ' + r.shiftX + 'px) | Raw Alpha: ' + r.rawAlphaAtForehead.toFixed(4) + ' | Stabilized Alpha: ' + r.stabAlphaAtForehead.toFixed(4) + ' | Ghosting: ' + ghost)
})

await browser.close()
