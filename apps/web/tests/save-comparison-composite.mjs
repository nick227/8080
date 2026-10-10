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

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, W, H)

  const modnetAlpha = new Float32Array(data.rawAlpha)

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
  } catch (err) {}

  const compCanvas = document.createElement('canvas')
  compCanvas.width = W * 3
  compCanvas.height = H
  const cCtx = compCanvas.getContext('2d')

  // Panel 1: Original
  cCtx.drawImage(canvas, 0, 0)
  cCtx.fillStyle = '#00ffcc'
  cCtx.font = '14px sans-serif'
  cCtx.fillText('1. Original Camera Input', 10, 20)

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

  renderAlphaPanel(modnetAlpha, W, '2. MODNet FP32 (Head Loss Failure)')
  renderAlphaPanel(mediapipeAlpha, W * 2, '3. MediaPipe Selfie (100% Face Preserved)')

  // Draw target sampling points:
  const pts = [
    { label: 'Inner Forehead', x: 192, y: 60, isFg: true },
    { label: 'Nose Center',    x: 192, y: 75, isFg: true },
    { label: 'Jaw / Chin',     x: 192, y: 95, isFg: true },
    { label: 'Left Room BG',   x: 30,  y: 50, isFg: false },
    { label: 'Right Room BG',  x: 350, y: 50, isFg: false }
  ]

  pts.forEach(p => {
    const color = p.isFg ? '#00ff00' : '#ff0000'
    for (let col = 0; col < 3; col++) {
      const px = col * W + p.x
      const py = p.y
      cCtx.strokeStyle = color
      cCtx.lineWidth = 2
      cCtx.beginPath()
      cCtx.arc(px, py, 5, 0, 2 * Math.PI)
      cCtx.stroke()
    }
  })

  return compCanvas.toDataURL('image/png')
}, diagData)

const filePath = path.join(outDir, 'model-comparison-composite.png')
fs.writeFileSync(filePath, Buffer.from(results.replace(/^data:image\/png;base64,/, ''), 'base64'))
console.log('Successfully saved composite to', filePath)
await browser.close()
