import fs from 'fs'
import path from 'path'
import { chromium } from '@playwright/test'

const diagPath = '/mnt/c/Users/Administrator/Downloads/vbg-synchronized-frame.json'
const outDir = '/home/administrator/web/voice-chat-v1/apps/web/docs/validation'

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

  const inputCanvas = document.createElement('canvas')
  inputCanvas.width = 640
  inputCanvas.height = 360
  const ctx = inputCanvas.getContext('2d')
  ctx.drawImage(img, 0, 0, 640, 360)

  const mp = await import('/src/features/vbg/mediapipeSource.ts')
  const mpSource = await mp.createMediapipeSource()

  const rawMask = await mpSource.run(inputCanvas, Date.now())

  const alphaCanvas = document.createElement('canvas')
  alphaCanvas.width = W
  alphaCanvas.height = H
  const aCtx = alphaCanvas.getContext('2d')
  const aData = aCtx.createImageData(W, H)
  
  if (rawMask) {
    const rawData = rawMask.data
    const rW = rawMask.width
    const rH = rawMask.height
    
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

  return compCanvas.toDataURL('image/png')
}, diagData)

const filePath = path.join(outDir, 'raw-mediapipe-composite.png')
fs.writeFileSync(filePath, Buffer.from(results.replace(/^data:image\/png;base64,/, ''), 'base64'))
console.log('Saved raw composite to', filePath)
await browser.close()
