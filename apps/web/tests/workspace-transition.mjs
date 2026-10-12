import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
const output = await mkdtemp(join(tmpdir(), 'workspace-transition-'))
const browser = await chromium.launch()
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'tests/workspace-transition.fixture.tsx', '--bundle', '--jsx=automatic', `--outfile=${join(output, 'fixture.js')}`], { stdio: 'pipe' })
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const css = await readFile(join(output, 'fixture.css'), 'utf8')
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://workspace.test/**', route => route.fulfill({ contentType: 'text/html', body: `<style>:root{--muted:#777;--line:#ccc}body{margin:0}#root{display:flex;flex-direction:column;height:100vh}${css}</style><div id="root"></div><script>${script}</script>` }))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('https://workspace.test/')
    await page.getByLabel('Draft').fill('Keep this draft')
    for (const view of ['Board', 'Calendar', 'Team', 'Lists']) await page.getByRole('button', { name: view, exact: true }).click()
    await expect(page.getByRole('heading')).toHaveText('Lists')
    await expect(page.getByLabel('Draft')).toHaveValue('Keep this draft')
    await page.waitForTimeout(250)
    assert.equal(await page.locator('.workspace-transition').evaluate(el => el.getAnimations().length), 0)
    await page.getByRole('button', { name: 'Toggle loading' }).click()
    await expect(page.getByRole('status')).toHaveAttribute('aria-label', 'Loading workspace…')
    await page.waitForTimeout(400)
    await expect(page.locator('.workspace-loading-indicator')).toHaveCSS('opacity', '1')
    assert.ok((await page.getByRole('status').boundingBox()).height >= 160)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('.workspace-loading-mark')).toHaveCSS('animation-name', 'none')
    await page.getByRole('button', { name: 'Toggle loading' }).click()
    await page.getByRole('button', { name: 'Board', exact: true }).click()
    assert.equal(await page.locator('.workspace-transition').evaluate(el => el.getAnimations().length), 0)
    await expect(page.locator('.workspace-content')).toHaveCSS('animation-name', 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  }
  assert.deepEqual(errors, [])
  console.log('Passed: rapid navigation, preserved state, settled fades, accessible loading, mobile layout, reduced motion.')
} finally { await browser.close(); await rm(output, { recursive: true, force: true }) }
