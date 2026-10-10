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
  } catch {}
})

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
console.log('Navigated to main app with 8080.vbg-source=mediapipe...')

const evalResult = await page.evaluate(async (data) => {
  try {
    const vc = await import('/src/features/virtualCamera.ts')
    const mp = await import('/src/features/vbg/mediapipeSource.ts')

    const source = await mp.createMediapipeSource()

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

    const outputStream = new MediaStream()
    const compositor = vc.startCompositor(
      source,
      outputStream,
      { mode: 'blur', photoUrl: null, mirror: false },
      () => {},
      { onFrame: () => {} }
    )

    const ReactMod = await import('/node_modules/.vite/deps/react.js')
    const React = ReactMod.default || ReactMod
    const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js')
    const createRoot = ReactDOM.createRoot || ReactDOM.default?.createRoot
    const { VbgReadout } = await import('/src/features/room/VbgReadout.tsx')

    let container = document.getElementById('test-hud-root')
    if (!container) {
      container = document.createElement('div')
      container.id = 'test-hud-root'
      document.body.appendChild(container)
    }
    const root = createRoot(container)
    root.render(React.createElement(VbgReadout))

    const frameStats = []
    let ts = 100
    for (let f = 0; f < 60; f++) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, 640, 360)
      const jitterX = Math.sin(f * 0.1) * 2
      const jitterY = Math.cos(f * 0.08) * 1.5
      ctx.drawImage(img, jitterX, jitterY, 640, 360)

      await compositor.evaluateFrame(inputCanvas, ts)
      ts += 33

      if (window.__vbgStats) {
        frameStats.push({ ...window.__vbgStats })
      }
    }

    const { captureDiagnostic } = await import('/src/features/vbg/diagnostics.ts')
    const lastDiag = window.__vbgDiagnosticPending
      ? await window.__vbgDiagnosticPending
      : null

    return {
      backend: source.backend,
      model: source.model,
      frameCount: frameStats.length,
      lastStats: frameStats[frameStats.length - 1],
      lastDiag,
    }
  } catch (err) {
    return { error: err.stack || String(err) }
  }
}, diagData)

console.log('\n============================================================')
console.log(' LIVE MEDIAPIPE PIPELINE AUDIT RESULTS')
console.log('============================================================')
console.log('Backend Reported:', evalResult.backend)
console.log('Model Reported:  ', evalResult.model)
console.log('Frame Count:     ', evalResult.frameCount)

if (evalResult.lastStats) {
  console.log('\nTelemetry Stats (Last Frame):')
  console.log('  • Source Backend:        ', evalResult.lastStats.backend)
  console.log('  • Inference Time:        ', evalResult.lastStats.inferMs ? evalResult.lastStats.inferMs.toFixed(1) + ' ms' : 'N/A')
  console.log('  • Mask Age:              ', evalResult.lastStats.maskAgeMs + ' ms')
  console.log('  • Prior Mask Held Rate:  ', evalResult.lastStats.priorMaskHeldPct + '%')
  console.log('  • Refinement Applied:    ', evalResult.lastStats.refineMode)
}

console.log('\nTesting HUD Button Click for synchronized diagnostic JSON export...')
const button = page.locator('.vbg-diagnostic-controls button')
if (await button.isVisible()) {
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 })
  await button.click()
  const download = await downloadPromise
  const downloadPath = path.join(outDir, 'mediapipe-live-synchronized-diag.json')
  await download.saveAs(downloadPath)
  console.log('Successfully captured and saved synchronized diagnostic JSON to:', downloadPath)

  const diagJson = JSON.parse(fs.readFileSync(downloadPath, 'utf8'))
  console.log('\nCaptured Diagnostic Package Verification:')
  console.log('  • Backend:          ', diagJson.backend)
  console.log('  • Model:            ', diagJson.model)
  console.log('  • Renderer:         ', diagJson.renderer)
  console.log('  • Refinement Mode:  ', diagJson.refinementApplied)
  console.log('  • Inference Time:   ', diagJson.inferenceMs + ' ms')
  console.log('  • Mask Grid Shape:  ', diagJson.width + ' x ' + diagJson.height)
  console.log('  • Has Raw Alpha:    ', Boolean(diagJson.rawAlpha))
  console.log('  • Has Stabilized:   ', Boolean(diagJson.stabilizedAlpha))
  console.log('  • Has Final Image:  ', Boolean(diagJson.final))
} else {
  console.log('HUD button not visible on screen.')
}

await browser.close()
