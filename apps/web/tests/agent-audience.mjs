import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
const output = await mkdtemp(join(tmpdir(), 'agent-audience-'))
const browser = await chromium.launch()
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'tests/agent-audience.fixture.tsx', '--bundle', '--jsx=automatic', `--outfile=${join(output, 'fixture.js')}`], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe' })
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const css = await readFile(join(output, 'fixture.css'), 'utf8')
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const errors = []
  const previews = []
  await context.route('https://audience.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    if (!path.startsWith('/api')) return route.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div id="root"></div><script>${script}</script>` })
    if (path.endsWith('/agent-audience/preview')) {
      previews.push(route.request().postDataJSON())
      return json({ data: { matchedCount: 3, recipientCount: 2, contacts: [{ id: 'c1', name: 'Alex', email: 'alex@example.com' }] } })
    }
    if (path.endsWith('/tags')) return json({ data: [{ id: 't1', name: 'Customer' }, { id: 't2', name: 'Pool cleaning' }] })
    if (path.endsWith('/vocabulary')) return json({ data: { stages: [{ key: 'qualified', label: 'Qualified', archived: false }], categories: [], fields: [] } })
    if (path.endsWith('/members')) return json({ data: [{ id: 'm1', status: 'active', user: { name: 'Sarah' } }] })
    if (path.endsWith('/fields')) return json({ data: [{ key: 'lastContactedAt', label: 'Last contacted', type: 'date', options: [] }] })
    return json({ data: [{ id: 'c1', displayName: 'Alex', primaryEmail: 'alex@example.com' }], meta: { nextCursor: null } })
  })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('https://audience.test/work?desk=agents')
  await page.getByRole('button', { name: '+ Add recipients', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add 0', exact: true })).toBeDisabled()
  assert.equal(previews.length, 0)
  await page.getByLabel('Category', { exact: true }).selectOption('Customer')
  await page.getByLabel('Location', { exact: true }).fill('Austin')
  await page.getByLabel('Tags', { exact: true }).selectOption('Pool cleaning')
  await page.getByRole('button', { name: '+ Attribute rule' }).click()
  await expect(page.getByRole('button', { name: 'Add 2', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Add 2', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('2 unique recipients', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'View contacts →' }).click()
  const config = JSON.parse(new URL(page.url()).searchParams.get('audience'))
  assert.deepEqual(config, previews.at(-1))
  assert.equal(config.filters.location[0], 'Austin')
  assert.equal(config.filters.attributes[0].op, 'before_days')
  await page.getByRole('button', { name: /Remove Category:/ }).click()
  await page.getByRole('button', { name: /Remove Location:/ }).click()
  await page.getByRole('button', { name: /Remove Tags:/ }).click()
  await page.getByRole('button', { name: /Remove Last contacted:/ }).click()
  await expect(page.getByRole('button', { name: '+ Add recipients', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '+ Add recipients', exact: true }).click()
  await page.getByLabel('Recipient mode').selectOption('SELECTED_CONTACTS')
  await page.getByRole('checkbox', { name: /Alex/ }).check()
  await expect(page.getByRole('button', { name: 'Add 2', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Add 2', exact: true }).click()
  await expect(page.getByRole('button', { name: '1 selected contacts', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '+ Edit audience', exact: true }).click()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.deepEqual(errors, [])
  console.log('Audience UI: empty TO, AND rules, live dedupe counts, exact Contacts link, removal, selection, mobile and Escape passed.')
} finally { await browser.close(); await rm(output, { recursive: true, force: true }) }
