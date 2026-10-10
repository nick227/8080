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
  const page = await browser.newPage({ permissions: ['camera'] })
  page.on('pageerror', error => console.error('BROWSER ERROR:', error.message))

  await page.goto('http://localhost:5173/')
  console.log('Navigated to main app at http://localhost:5173/...')

  console.log('Triggering requestVbgDiagnostic in live app context...')
  const diagnosticJson = await page.evaluate(async () => {
    const { requestVbgDiagnostic } = await import('/src/features/vbg/diagnostics.ts')
    const { startCompositor } = await import('/src/features/virtualCamera.ts')

    const frame = document.createElement('canvas')
    frame.width = 640
    frame.height = 360
    const ctx = frame.getContext('2d')
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, 640, 360)
    ctx.fillStyle = '#ffcc99'
    ctx.beginPath()
    ctx.arc(320, 180, 70, 0, Math.PI * 2)
    ctx.fill()

    const mockSource = {
      backend: 'modnet/webgpu',
      model: 'modnet-fp16',
      sync: false,
      inputSize: () => ({ width: 384, height: 216 }),
      run: async () => {
        const data = new Float32Array(384 * 216)
        for (let y = 0; y < 216; y++) {
          for (let x = 0; x < 384; x++) {
            const dx = (x - 192) / 40
            const dy = (y - 108) / 40
            data[y * 384 + x] = (dx * dx + dy * dy <= 1.0) ? 1.0 : 0.0
          }
        }
        return { data, width: 384, height: 216 }
      },
    }

    const compositor = startCompositor(
      mockSource,
      new MediaStream(),
      { mode: 'blur', photoUrl: null, mirror: false },
      () => {},
      { onFrame: () => {} },
    )

    // Call requestVbgDiagnostic BEFORE evaluateFrame so segment() picks it up
    const promise = requestVbgDiagnostic()
    await compositor.evaluateFrame(frame, 1)
    const blob = await promise
    compositor.stop()
    return await blob.text()
  })

  const outFile = path.join(outDir, 'vbg-synchronized-frame.json')
  fs.writeFileSync(outFile, diagnosticJson, 'utf8')
  console.log(`Saved synchronized diagnostic bundle to ${outFile}`)

  const json = JSON.parse(diagnosticJson)
  assert.ok(json.original, 'Must contain original camera frame')
  assert.ok(json.inferenceInput, 'Must contain inference input')
  assert.ok(json.rawAlpha, 'Must contain raw alpha')
  assert.ok(json.stabilizedAlpha, 'Must contain stabilized alpha')
  assert.ok(json.final, 'Must contain final composite')

  console.log('SUCCESS: Diagnostic JSON bundle verified and saved!')
} finally {
  await browser.close()
}
