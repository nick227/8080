import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
const temp = await mkdtemp(join(tmpdir(), 'vbg-refiner-'))
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'src/features/vbg/edgeRefiner.ts', '--bundle', '--format=iife', '--global-name=Refiner', `--outfile=${join(temp, 'refiner.js')}`])
  const page = await browser.newPage()
  await page.addScriptTag({ content: await readFile(join(temp, 'refiner.js'), 'utf8') })
  const result = await page.evaluate(() => {
    const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h })
    const guide = canvas(64, 64), mask = canvas(8, 8), copy = canvas(64, 64)
    const g = guide.getContext('2d'), m = mask.getContext('2d'), c = copy.getContext('2d')
    // Horizontal edge also detects flipped texture uploads.
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 32)
    g.fillStyle = '#111'; g.fillRect(0, 32, 64, 32)
    m.fillRect(0, 0, 8, 4)
    const refiner = Refiner.createEdgeRefiner()
    if (!refiner) throw new Error('WebGL2 refiner unavailable')
    c.drawImage(mask, 0, 0, 64, 64)
    const before = c.getImageData(0, 0, 64, 64).data
    const refined = refiner.render(guide, mask, 64, 64)
    if (!refined) throw new Error('Shader failed')
    c.globalCompositeOperation = 'copy'; c.drawImage(refined, 0, 0)
    const after = c.getImageData(0, 0, 64, 64).data
    const alpha = (pixels, y) => pixels[(y * 64 + 32) * 4 + 3]
    const error = pixels => Array.from({ length: 64 }, (_, y) => Math.abs(alpha(pixels, y) - (y < 32 ? 255 : 0))).reduce((a, b) => a + b, 0)
    const scores = { before: error(before), after: error(after), top: alpha(after, 8), bottom: alpha(after, 56) }
    // Output resize and graceful loss of the GPU context.
    const resized = refiner.render(guide, mask, 32, 48)
    scores.resized = resized?.width === 32 && resized?.height === 48
    refined.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()
    scores.fallback = refiner.render(guide, mask, 64, 64) === null
    refiner.dispose()
    return scores
  })
  assert.equal(result.top, 255)
  assert.equal(result.bottom, 0)
  assert.ok(result.after < result.before * 0.65, JSON.stringify(result))
  assert.ok(result.resized)
  assert.ok(result.fallback)
  console.log('RGB-guided shader checks passed:', result)
} finally { await browser.close(); await rm(temp, { recursive: true, force: true }) }
