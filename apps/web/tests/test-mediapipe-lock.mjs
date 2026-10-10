import fs from 'fs'
import path from 'path'
import { chromium } from '@playwright/test'

const diagPath = '/mnt/c/Users/Administrator/Downloads/vbg-synchronized-frame.json'
const outDir = path.resolve(process.cwd(), 'docs/validation')

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

const res = await page.evaluate(async () => {
  const { loadMaskSource, currentMaskSource } = await import('/src/features/vbg/maskSource.ts')
  const src = await loadMaskSource()
  await new Promise(r => setTimeout(r, 1000)) // Wait 1 sec to ensure background upgrade does not trigger
  const afterWaitSrc = currentMaskSource()
  return {
    initialBackend: src.backend,
    initialModel: src.model,
    afterWaitBackend: afterWaitSrc ? afterWaitSrc.backend : null,
    afterWaitModel: afterWaitSrc ? afterWaitSrc.model : null,
  }
})

console.log('=== MEDIAPIPE OVERRIDE LOCK VERIFICATION ===')
console.log('Initial Backend:   ', res.initialBackend)
console.log('Initial Model:     ', res.initialModel)
console.log('After Wait Backend:', res.afterWaitBackend)
console.log('After Wait Model:  ', res.afterWaitModel)

await browser.close()
