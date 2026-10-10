import fs from 'fs'
import path from 'path'
import { chromium } from '@playwright/test'

const diagPath = '/mnt/c/Users/Administrator/Downloads/vbg-synchronized-frame.json'
const outDir = path.resolve(process.cwd(), 'docs/validation')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

const diagData = JSON.parse(fs.readFileSync(diagPath, 'utf8'))

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox']
})
const page = await browser.newPage()

page.on('pageerror', (err) => console.error('PAGE ERROR:', err))
page.on('console', (msg) => console.log('PAGE LOG:', msg.text()))

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

  // 1. Evaluate Old Ellipse Overlay on Original Frame
  const ellipseCanvas = document.createElement('canvas')
  ellipseCanvas.width = W
  ellipseCanvas.height = H
  const eCtx = ellipseCanvas.getContext('2d')
  eCtx.drawImage(origCanvas, 0, 0)
  
  eCtx.strokeStyle = '#ffff00'
  eCtx.lineWidth = 2
  eCtx.setLineDash([4, 4])
  eCtx.beginPath()
  eCtx.ellipse(192, 60, 45, 50, 0, 0, 2 * Math.PI)
  eCtx.stroke()

  const oldEllipseMask = new Uint8Array(W * H)
  let oldEllipseTotal = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - 192) / 45
      const dy = (y - 60) / 50
      if (dx * dx + dy * dy <= 1.0) {
        oldEllipseMask[y * W + x] = 1
        oldEllipseTotal++
      }
    }
  }

  // 2. Ground-Truth Per-Pixel Head Contour
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

  // 3. Render Visual Overlays
  const overlayEllipseUrl = ellipseCanvas.toDataURL('image/png')

  const headOverlayCanvas = document.createElement('canvas')
  headOverlayCanvas.width = W
  headOverlayCanvas.height = H
  const hoCtx = headOverlayCanvas.getContext('2d')
  hoCtx.drawImage(origCanvas, 0, 0)
  const hoData = hoCtx.getImageData(0, 0, W, H)
  const hoPx = hoData.data
  for (let i = 0; i < W * H; i++) {
    if (perPixelHeadMask[i] === 1) {
      hoPx[i * 4] = Math.min(255, hoPx[i * 4] * 0.5)
      hoPx[i * 4 + 1] = Math.min(255, hoPx[i * 4 + 1] + 100)
      hoPx[i * 4 + 2] = Math.min(255, hoPx[i * 4 + 2] + 150)
    }
  }
  hoCtx.putImageData(hoData, 0, 0)
  const overlayPerPixelHeadUrl = headOverlayCanvas.toDataURL('image/png')

  // 4. Recalculate Retention Metrics on Raw MODNet Output
  const rawAlpha = new Float32Array(data.rawAlpha)

  let ellipseFg = 0
  for (let i = 0; i < W * H; i++) {
    if (oldEllipseMask[i] === 1 && rawAlpha[i] >= 0.5) ellipseFg++
  }
  const oldEllipseRetention = (ellipseFg / oldEllipseTotal) * 100

  let perPixelHeadFg = 0
  let perPixelHeadErased = 0
  for (let i = 0; i < W * H; i++) {
    if (perPixelHeadMask[i] === 1) {
      if (rawAlpha[i] >= 0.5) perPixelHeadFg++
      else perPixelHeadErased++
    }
  }
  const perPixelHeadRetention = (perPixelHeadFg / perPixelHeadTotal) * 100

  // 5. Create Comparison Composite Snapshot (Original with Contour | Raw Alpha | Erased Head Pixels in Bright Red)
  const compCanvas = document.createElement('canvas')
  compCanvas.width = W * 3
  compCanvas.height = H
  const cCtx = compCanvas.getContext('2d')

  cCtx.drawImage(headOverlayCanvas, 0, 0)

  const alphaCanvas = document.createElement('canvas')
  alphaCanvas.width = W
  alphaCanvas.height = H
  const aCtx = alphaCanvas.getContext('2d')
  const aData = aCtx.createImageData(W, H)
  for (let i = 0; i < W * H; i++) {
    const v = Math.floor(rawAlpha[i] * 255)
    aData.data[i * 4] = v
    aData.data[i * 4 + 1] = v
    aData.data[i * 4 + 2] = v
    aData.data[i * 4 + 3] = 255
  }
  aCtx.putImageData(aData, 0, 0)
  cCtx.drawImage(alphaCanvas, W, 0)

  const errCanvas = document.createElement('canvas')
  errCanvas.width = W
  errCanvas.height = H
  const errCtx = errCanvas.getContext('2d')
  errCtx.drawImage(origCanvas, 0, 0)
  const errData = errCtx.getImageData(0, 0, W, H)
  const errPx = errData.data
  for (let i = 0; i < W * H; i++) {
    if (perPixelHeadMask[i] === 1 && rawAlpha[i] < 0.5) {
      errPx[i * 4] = 255
      errPx[i * 4 + 1] = 0
      errPx[i * 4 + 2] = 0
      errPx[i * 4 + 3] = 230
    }
  }
  errCtx.putImageData(errData, 0, 0)
  cCtx.drawImage(errCanvas, W * 2, 0)

  const compositeUrl = compCanvas.toDataURL('image/png')

  return {
    oldEllipseTotal,
    perPixelHeadTotal,
    oldEllipseRetention,
    perPixelHeadRetention,
    perPixelHeadFg,
    perPixelHeadErased,
    overlayEllipseUrl,
    overlayPerPixelHeadUrl,
    compositeUrl,
  }
}, diagData)

console.log('=== REGION ANNOTATION AUDIT RESULTS ===')
console.log('Old Ellipse Region Total Pixels:          ' + results.oldEllipseTotal)
console.log('Per-Pixel Head Annotation Total Pixels:   ' + results.perPixelHeadTotal)
console.log('--------------------------------------------------')
console.log('Retention vs Old Bounding Ellipse:        ' + results.oldEllipseRetention.toFixed(2) + '%')
console.log('Retention vs Ground-Truth Per-Pixel Head: ' + results.perPixelHeadRetention.toFixed(2) + '% (' + results.perPixelHeadFg + ' retained / ' + results.perPixelHeadErased + ' erased)')

fs.writeFileSync(path.join(outDir, 'overlay-old-ellipse.png'), Buffer.from(results.overlayEllipseUrl.replace(/^data:image\/png;base64,/, ''), 'base64'))
fs.writeFileSync(path.join(outDir, 'overlay-per-pixel-head.png'), Buffer.from(results.overlayPerPixelHeadUrl.replace(/^data:image\/png;base64,/, ''), 'base64'))
fs.writeFileSync(path.join(outDir, 'audit-ground-truth-composite.png'), Buffer.from(results.compositeUrl.replace(/^data:image\/png;base64,/, ''), 'base64'))

console.log('Saved audit visual overlays to docs/validation/')
await browser.close()
