import { loadStyles } from './style-utils.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const output = await mkdtemp(join(tmpdir(), 'theme-switcher-'))
const browser = await chromium.launch()
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'tests/theme-switcher.fixture.tsx', '--bundle', '--jsx=automatic', `--outfile=${join(output, 'fixture.js')}`], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe',
  })
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const css = await loadStyles()
  const context = await browser.newContext()
  await context.route('http://theme.test/**', route => route.fulfill({
    contentType: 'text/html', body: `<style>${css}</style><div id="root"></div><script>${script}</script>`,
  }))
  const page = await context.newPage()
  await page.goto('http://theme.test/')
  const select = page.getByRole('combobox', { name: 'Theme' })
  await select.waitFor()
  assert.equal(await select.inputValue(), 'dark')
  await select.selectOption('light')
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light')
  await page.reload()
  await select.waitFor()
  assert.equal(await select.inputValue(), 'light')
  const second = await context.newPage()
  await second.goto('http://theme.test/')
  await second.getByRole('combobox', { name: 'Theme' }).waitFor()
  await select.selectOption('dark')
  await second.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  assert.equal(await second.getByRole('combobox', { name: 'Theme' }).inputValue(), 'dark')
  await page.evaluate(() => localStorage.setItem('8080.theme', 'removed-theme'))
  await page.reload()
  await select.waitFor()
  assert.equal(await select.inputValue(), 'dark')
  await page.setViewportSize({ width: 320, height: 640 })
  const boxes = await page.locator('.mast, .mast-actions').evaluateAll(nodes => nodes.map(node => {
    const { left, right } = node.getBoundingClientRect(); return { left, right }
  }))
  assert.ok(boxes[0].right <= boxes[1].left && boxes[1].right <= 320, 'Header controls overlap on mobile')
  const noStorage = await browser.newContext()
  await noStorage.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('blocked') }
    Storage.prototype.setItem = () => { throw new Error('blocked') }
  })
  await noStorage.route('http://theme.test/**', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${script}</script>` }))
  const blocked = await noStorage.newPage()
  await blocked.goto('http://theme.test/')
  await blocked.getByRole('combobox', { name: 'Theme' }).selectOption('light')
  assert.equal(await blocked.locator('html').getAttribute('data-theme'), 'light')
  console.log('Theme switcher persistence, tab sync, fallback, storage failure, and mobile checks passed.')
} finally {
  await browser.close()
  await rm(output, { recursive: true, force: true })
}
