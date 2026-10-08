import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { loadStyles } from './style-utils.mjs'

const output = await mkdtemp(join(tmpdir(), 'creation-'))
const browser = await chromium.launch()
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'tests/creation.fixture.tsx', '--bundle', '--jsx=automatic', `--outfile=${join(output, 'fixture.js')}`], { stdio: 'pipe' })
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const css = await loadStyles() + await readFile(join(output, 'fixture.css'), 'utf8')
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://creation.test/**', (route) => {
    if (new URL(route.request().url()).pathname.startsWith('/api')) return route.fulfill({ json: { data: [] } })
    return route.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div id="root"></div><script>${script}</script>` })
  })
  await page.goto('https://creation.test')
  const newTask = page.getByRole('button', { name: 'New task', exact: true })
  await newTask.click()
  const taskDialog = page.getByRole('dialog', { name: 'New task' })
  await expect(taskDialog).toBeVisible()
  await expect(page.locator('.cal-board')).toBeAttached()
  await expect(taskDialog.getByLabel('Task', { exact: true })).toBeFocused()
  await taskDialog.getByLabel('Task', { exact: true }).fill('Review the brief')
  await taskDialog.getByLabel('Date', { exact: true }).fill('2026-10-06')
  await taskDialog.getByLabel('Time (optional)').fill('14:30')
  await taskDialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(taskDialog).toHaveCount(0)
  await expect(newTask).toBeFocused()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vc-tasks')).at(-1))).toMatchObject({ title: 'Review the brief', day: '2026-10-06', time: '14:30' })
  await newTask.click()
  await page.keyboard.press('Escape')
  await expect(taskDialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Documents page' }).click()
  await expect(page.getByRole('button', { name: /^New / })).toHaveCount(1)
  for (const [value, surface] of [['blocks', 'blocks'], ['grid', 'grid'], ['mental_map', 'mental_map']]) {
    await page.getByRole('button', { name: 'New document', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New document' })
    await dialog.getByLabel('Document type').selectOption(value)
    const box = await dialog.boundingBox()
    if (Math.abs(box.x + box.width - 1280) > 1) throw new Error('Slideout is not right aligned')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByLabel('Created surfaces')).toContainText(surface)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  const mobile = await page.getByRole('dialog').boundingBox()
  if (mobile.width > 390 || mobile.x < 0) throw new Error('Slideout overflows mobile viewport')
  await page.keyboard.press('Escape')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('Creation flows passed: task persistence, unchanged calendar view, document types, focus restoration, Escape, desktop and mobile slideouts.')
} finally {
  await browser.close()
  await rm(output, { recursive: true, force: true })
}
