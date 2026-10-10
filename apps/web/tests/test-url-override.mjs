import fs from 'fs'
import path from 'path'
import { chromium } from '@playwright/test'

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

// Navigate directly to URL with ?vbg=mediapipe parameter
await page.goto('http://localhost:5173/?vbg=mediapipe', { waitUntil: 'domcontentloaded' })

const res = await page.evaluate(async () => {
  const { loadMaskSource, currentMaskSource } = await import('/src/features/vbg/maskSource.ts')
  const src = await loadMaskSource()
  await new Promise(r => setTimeout(r, 1000))
  const afterWaitSrc = currentMaskSource()
  return {
    initialBackend: src.backend,
    initialModel: src.model,
    afterWaitBackend: afterWaitSrc ? afterWaitSrc.backend : null,
    afterWaitModel: afterWaitSrc ? afterWaitSrc.model : null,
  }
})

console.log('=== URL QUERY OVERRIDE VERIFICATION (?vbg=mediapipe) ===')
console.log('Initial Backend:   ', res.initialBackend)
console.log('Initial Model:     ', res.initialModel)
console.log('After Wait Backend:', res.afterWaitBackend)
console.log('After Wait Model:  ', res.afterWaitModel)

await browser.close()
