import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
const output = await mkdtemp(join(tmpdir(), 'chat-launcher-'))
const browser = await chromium.launch()
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'tests/chat-launcher.fixture.tsx', '--bundle', '--jsx=automatic', `--outfile=${join(output, 'fixture.js')}`], { stdio: 'pipe' })
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const css = await readFile(join(output, 'fixture.css'), 'utf8')
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://chat.test/**', route => route.fulfill({ contentType: 'text/html', body: `<style>:root{--bg:#fff;--ink:#222;--muted:#777;--line:#ccc;--line-width:1px;--radius-pill:999px;--chat-panel-min-width:300px;--chat-panel-width:360px}body{margin:0}${css}</style><div id="root"></div><script>${script}</script>` }))
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 900})
    await page.goto('https://chat.test/')
    const launcher = page.getByRole('button', {name: 'Show chat, 2 unseen messages', exact: true})
    await expect(launcher).toBeVisible()
    await page.waitForTimeout(150)
    await expect(launcher).toBeVisible()
    const box = await launcher.boundingBox()
    assert.equal(box.width, 56); assert.equal(box.height, 56)
    assert.equal(Math.round(box.x + box.width), width - 20)
    assert.equal(Math.round(box.y + box.height), 880)
    await page.getByRole('button', {name: 'Incoming', exact: true}).click()
    await expect(page.getByRole('button', {name: 'Show chat, 3 unseen messages', exact: true})).toBeVisible()
    await page.getByRole('button', {name: 'Show chat, 3 unseen messages', exact: true}).click()
    await expect(page.getByRole('button', {name: 'Hide chat', exact: true})).toBeVisible()
    await page.getByRole('button', {name: 'Hide chat', exact: true}).click()
    await expect(page.getByRole('button', {name: 'Show chat', exact: true})).toBeVisible()
    await expect(page.locator('.room-chat-count')).toHaveCount(0)
  }
  assert.deepEqual(errors, [])
  console.log('Passed: desktop/mobile lower-right square, hidden messages stay unseen, live count, opening clears count.')
} finally { await browser.close(); await rm(output, {recursive: true, force: true}) }
