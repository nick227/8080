import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

// Runs Playwright against the VBG page to capture a single synchronized diagnostic JSON bundle.
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
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()))
  page.on('pageerror', error => console.error('BROWSER ERROR:', error.message))

  await page.goto('http://localhost:5173/vbg-lab.html')
  await page.getByRole('heading', { name: 'Head retention lab' }).waitFor()

  console.log('Navigated to VBG Lab. Evaluating single frame capture...')

  const diagnosticJson = await page.evaluate(async () => {
    const { requestVbgDiagnostic } = await import('/src/features/vbg/diagnostics.ts')
    const { startCompositor } = await import('/src/features/virtualCamera.ts')
    const { createModnetSource } = await import('/src/features/vbg/modnetSource.ts')

    // Create a 640x360 test frame with high contrast face silhouette
    const frame = document.createElement('canvas')
    frame.width = 640
    frame.height = 360
    const ctx = frame.getContext('2d')
    ctx.fillStyle = '#222'
    ctx.fillRect(0, 0, 640, 360)
    // Draw face ellipse
    ctx.fillStyle = '#d4a373'
    ctx.beginPath()
    ctx.ellipse(320, 180, 80, 110, 0, 0, Math.PI * 2)
    ctx.fill()

    let capturedBlob = null
    const source = {
      backend: 'modnet/webgpu-fp32',
      model: 'modnet-fp32',
      sync: false,
      inputSize: () => ({ width: 384, height: 216 }),
      run: async () => {
        // Mock float32 alpha mask: 1.0 inside face region, 0.0 outside
        const data = new Float32Array(384 * 216)
        for (let y = 0; y < 216; y++) {
          for (let x = 0; x < 384; x++) {
            const dx = (x - 192) / 48
            const dy = (y - 108) / 66
            data[y * 384 + x] = (dx * dx + dy * dy <= 1.0) ? 1.0 : 0.0
          }
        }
        return { data, width: 384, height: 216 }
      },
    }

    const compositor = startCompositor(source, new MediaStream(), { mode: 'blur', photoUrl: null, mirror: false })
    const promise = requestVbgDiagnostic()
    await compositor.evaluateFrame(frame, performance.now())
    const blob = await promise
    compositor.stop()

    return await blob.text()
  })

  const outFile = path.join(outDir, 'vbg-synchronized-frame.json')
  fs.writeFileSync(outFile, diagnosticJson, 'utf8')
  console.log(`Successfully saved diagnostic bundle to ${outFile}`)
} finally {
  await browser.close()
}
