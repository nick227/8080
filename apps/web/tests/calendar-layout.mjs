import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { loadStyles } from './style-utils.mjs'
const output = await mkdtemp(join(tmpdir(), 'calendar-layout-'))
const browser = await chromium.launch()
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'tests/calendar-layout.fixture.tsx', '--bundle', '--jsx=automatic', `--outfile=${join(output, 'fixture.js')}`], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe' })
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const css = (await loadStyles()) + await readFile(join(output, 'fixture.css'), 'utf8')
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://calendar.test/**', route => route.fulfill({ contentType: 'text/html', body: `<style>${css}body{margin:0}</style><div id="root"></div><script>${script}</script>` }))
  await page.goto('https://calendar.test/')
  await expect(page.getByRole('heading', { name: /^(Calendar|Work Management)$/ })).toBeVisible()
  assert.ok(!(await page.locator('body').innerText()).includes('Sprint 24'))
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(page.getByText('2 tasks in this view', { exact: true })).toBeVisible()
  const listWidth = await page.locator('.cal-list-days').evaluate(el => el.getBoundingClientRect().width)
  const listHeight = await page.locator('.cal-row').first().evaluate(el => el.getBoundingClientRect().height)
  await page.getByRole('button', { name: 'Next month', exact: true }).click()
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('1 tasks in this view', { exact: true })).toBeVisible()
  await page.getByLabel('More task views').selectOption('backlog')
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveCount(0)
  await expect(page.getByText('3 tasks in this view', { exact: true })).toBeVisible()
  const backlogWidth = await page.locator('.cal-backlog-container').evaluate(el => el.getBoundingClientRect().width)
  const backlogHeight = await page.locator('.cal-backlog-row').first().evaluate(el => el.getBoundingClientRect().height)
  assert.ok(Math.abs(listWidth - backlogWidth) <= 1, `${listWidth} != ${backlogWidth}`)
  assert.ok(Math.abs(listHeight - backlogHeight) <= 1, `${listHeight} != ${backlogHeight}`)
  await page.setViewportSize({ width: 1920, height: 1080 })
  const expandedWidth = await page.locator('.cal-backlog-container').evaluate(el => el.getBoundingClientRect().width)
  assert.ok(expandedWidth > backlogWidth, 'Backlog fills an expanded workspace')
  await page.screenshot({ path: '/tmp/calendar-backlog-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.getByRole('button', { name: 'Day', exact: true }).click()
  const title = await page.locator('.cal-period').innerText()
  await page.getByRole('button', { name: 'Next day', exact: true }).click()
  assert.notEqual(await page.locator('.cal-period').innerText(), title)
  await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('More task views').selectOption('board')
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveCount(0)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: '/tmp/calendar-board-mobile.png' })
  assert.deepEqual(errors, [])
  console.log('Calendar layout: header, equal list/backlog widths and row heights, scoped controls/counts, navigation, expansion, mobile overflow, no sprint banner passed.')
} finally { await browser.close(); await rm(output, { recursive: true, force: true }) }
