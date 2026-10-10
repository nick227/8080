import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const outDir = path.resolve('docs/validation')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
})

try {
  const context = await browser.newContext({ permissions: ['camera'] })
  const page = await context.newPage()
  page.on('pageerror', error => console.error('BROWSER ERROR:', error.message))
  page.on('console', msg => console.log('PAGE LOG:', msg.text()))

  // Ensure dev debug flag is set so VbgReadout renders
  await page.addInitScript(() => {
    try { localStorage.setItem('8080.vbg-debug', '1') } catch {}
  })

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
  console.log('Navigated to main app at http://localhost:5173/...')

  // Evaluate directly in live app context to start camera preview and mount VbgReadout via React createRoot
  console.log('Starting live virtual camera preview...')
  const evalResult = await page.evaluate(async () => {
    try {
      const vc = await import('/src/features/virtualCamera.ts')
      const mockSource = {
        backend: 'modnet/webgpu',
        model: 'modnet-fp16',
        sync: false,
        inputSize: () => ({ width: 384, height: 216 }),
        run: async () => {
          const data = new Float32Array(384 * 216).fill(1.0)
          return { data, width: 384, height: 216 }
        },
      }

      const testCanvas = document.createElement('canvas')
      testCanvas.width = 640
      testCanvas.height = 360
      const ctx = testCanvas.getContext('2d')
      ctx.fillStyle = '#222'
      ctx.fillRect(0, 0, 640, 360)

      const stream = new MediaStream()
      const compositor = vc.startCompositor(mockSource, stream, { mode: 'blur', photoUrl: null, mirror: false }, () => {}, { onFrame: () => {} })
      window.testCompositor = compositor
      window.testCanvas = testCanvas

      await compositor.evaluateFrame(testCanvas, 100)

      // Start continuous evaluation loop (30fps) to process live frames
      let frameTs = 133
      window.frameTimer = setInterval(() => {
        compositor.evaluateFrame(testCanvas, frameTs).catch(() => {})
        frameTs += 33
      }, 33)

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
      
      await new Promise(r => setTimeout(r, 600))
      return 'MOUNTED_OK: html=' + container.innerHTML
    } catch (err) {
      return 'EVAL_ERR: ' + err.stack
    }
  })
  console.log('Eval result:', evalResult)

  // Wait for the diagnostic controls button to be visible in the live DOM
  console.log('Waiting for "Save synchronized diagnostic frame" button in live DOM...')
  const button = page.locator('.vbg-diagnostic-controls button')
  await button.waitFor({ state: 'visible', timeout: 15000 })

  // Verify button properties: visible, correct pointer-events, no clipping
  const isVisible = await button.isVisible()
  assert.ok(isVisible, 'Save synchronized diagnostic frame button must be visible')

  const boundingBox = await button.boundingBox()
  assert.ok(boundingBox, 'Button must have valid bounding box')
  console.log('Button bounding box:', boundingBox)
  assert.ok(boundingBox.width > 0 && boundingBox.height > 0, 'Button width and height must be > 0')
  assert.ok(boundingBox.x >= 0 && boundingBox.y >= 0, 'Button position must not be clipped off-screen')

  const pointerEvents = await button.evaluate(el => getComputedStyle(el).pointerEvents)
  console.log('Button computed pointer-events:', pointerEvents)
  assert.notEqual(pointerEvents, 'none', 'Button pointer-events must not be none')

  console.log('Clicking "Save synchronized diagnostic frame" button...')
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 })
  await button.click()
  const download = await downloadPromise

  const downloadPath = path.join(outDir, 'vbg-ui-downloaded-frame.json')
  await download.saveAs(downloadPath)
  console.log(`Saved downloaded diagnostic JSON to ${downloadPath}`)

  const content = fs.readFileSync(downloadPath, 'utf8')
  const json = JSON.parse(content)

  assert.ok(json.original, 'Must contain original camera frame')
  assert.ok(json.inferenceInput, 'Must contain inference input')
  assert.ok(json.rawAlpha, 'Must contain raw alpha')
  assert.ok(json.stabilizedAlpha, 'Must contain stabilized alpha')
  assert.ok(json.final, 'Must contain final composite')

  console.log('SUCCESS: Live Chrome UI button click and synchronized JSON download verified!')
} finally {
  await browser.close()
}
