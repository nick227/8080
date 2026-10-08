import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { loadStyles } from './style-utils.mjs'

const output = await mkdtemp(join(tmpdir(), 'contact-workbench-'))
const browser = await chromium.launch()
const errors = []
const stamp = '2026-10-01T12:00:00.000Z'
const people = [
  { id: 'c1', displayName: 'Dana Ruiz', primaryEmail: 'dana@example.com', primaryPhone: '+15550102000', interestedIn: 'Studio lighting', accounts: [{ accountId: 'a1', name: 'Cobalt Studio', isPrimary: true, endedAt: null }] },
  { id: 'c2', displayName: 'Eli Chen', primaryEmail: null, primaryPhone: null, interestedIn: null, accounts: [] },
].map(c => ({ workspaceId: 'w1', version: 1, status: 'active', leadStatus: 'new', leadSource: 'Website', ownerMemberId: 'm1', nextFollowUp: null,
  contacted: false, qualified: false, proposalSent: false, won: false, nextAction: null, lastContactedAt: null, priority: 'normal', waitingOn: null, potentialValue: null, fieldValues: {},
  tags: [], points: [], createdAt: stamp, updatedAt: stamp, lastActivityAt: null, ...c }))
let failure = null
let lastQuery = null
const writes = []
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'tests/contact-workbench.fixture.tsx', '--bundle', '--jsx=automatic', `--outfile=${join(output, 'fixture.js')}`], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe' })
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const css = (await loadStyles()) + await readFile(join(output, 'fixture.css'), 'utf8')
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.route('https://contacts.test/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/api', '')
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (!url.pathname.startsWith('/api')) return route.fulfill({ contentType: 'text/html', body: `<style>${css}body{margin:0}</style><div id="root"></div><script>${script}</script>` })
    if (path === '/auth/guest' || path === '/auth/me') return json({ data: { id: 'u1', displayName: 'Owner', isGuest: false } })
    if (path === '/workspaces') return json({ data: [{ id: 'w1', name: 'Studio', defaultCurrency: 'USD' }] })
    if (path.endsWith('/members')) return json({ data: [{ id: 'm1', status: 'active', user: { id: 'u1', name: 'Owner' } }] })
    if (path.endsWith('/fields')) return json({ data: [
      ...['contacted', 'qualified', 'proposalSent', 'won'].map((key, position) => ({ key, label: ({contacted: 'Contacted', qualified: 'Qualified', proposalSent: 'Proposal sent', won: 'Won'})[key], type: 'checkbox', position: position + 50, archived: false, options: [] })),
      ...['nextAction', 'interestedIn', 'lastContactedAt', 'priority', 'waitingOn', 'potentialValue'].map((key, i) => ({ key, label: ({nextAction:'Next action',interestedIn:'Interested in',lastContactedAt:'Last contacted',priority:'Priority',waitingOn:'Waiting on',potentialValue:'Potential value'})[key], type: key === 'potentialValue' ? 'number' : ['priority','waitingOn'].includes(key) ? 'select' : 'text', position:({nextAction:60,interestedIn:30,lastContactedAt:80,priority:90,waitingOn:100,potentialValue:110})[key], archived:false, options: key === 'priority' ? ['low','normal','high'].map(value=>({value,label:value})) : ['us','them'].map(value=>({value,label:value})) })),
    ] })
    if (path.endsWith('/counts')) return json({ data: { all: 2, due: 0, overdue: 0, unassigned: 0, archived: 0 } })
    if (path === '/workspaces/w1/contacts') {
      lastQuery = url.searchParams
      const q = (url.searchParams.get('q') || '').toLowerCase()
      const rows = people.filter(c => JSON.stringify(c).toLowerCase().includes(q) && (!url.searchParams.get('milestone') || c[url.searchParams.get('milestone')] === (url.searchParams.get('checked') === 'true')))
      return json({ data: rows, meta: { total: rows.length, nextCursor: null } })
    }
    const match = path.match(/^\/workspaces\/w1\/contacts\/(c\d+)$/)
    if (match) {
      const c = people.find(c => c.id === match[1])
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON(); writes.push(body)
        if (failure) return json(failure, failure.code === 'CONTACT_VERSION_CONFLICT' ? 409 : 500)
        assert.equal(body.expectedVersion, c.version)
        Object.assign(c, body, { version: c.version + 1 })
        if (body.logContact) { c.contacted = true; c.lastContactedAt = new Date().toISOString() }
      }
      return json({ data: c })
    }
    if (path.endsWith('/notes')) return json({ data: [], meta: { nextCursor: null } })
    return json({ data: [], meta: { nextCursor: null } })
  })
  const page = await context.newPage()
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.goto('https://contacts.test/work?desk=contacts')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Follow-up/ })).toHaveAttribute('aria-sort', 'ascending')
  assert.equal(lastQuery.get('sort'), 'followUp')
  await page.getByLabel('Qualified for Dana Ruiz').check()
  await expect(page.getByLabel('Qualified for Dana Ruiz')).toBeChecked()
  assert.equal(people[0].qualified, true)
  assert.equal(people[0].leadStatus, 'new')
  const action = page.getByLabel('Next action for Dana Ruiz')
  await action.fill('Send pricing'); await action.press('Enter')
  await expect.poll(() => people[0].nextAction).toBe('Send pricing')
  await expect(action).toBeEnabled()
  await action.fill('Discard this'); await action.press('Escape')
  await expect(action).toHaveValue('Send pricing')
  await page.getByLabel('Stage for Dana Ruiz').selectOption('qualified')
  await expect.poll(() => people[0].leadStatus).toBe('qualified')
  await page.getByRole('columnheader', { name: /Qualified/ }).getByRole('button').click()
  await expect.poll(() => lastQuery.get('sort')).toBe('qualified')
  await page.getByLabel('Secondary sort', { exact: true }).selectOption('potentialValue')
  await expect.poll(() => lastQuery.get('thenSort')).toBe('potentialValue')
  await page.getByRole('searchbox', { name: 'Search contacts' }).fill('Cobalt')
  await expect(page.locator('[data-record-link]')).toHaveCount(1)
  await expect.poll(() => lastQuery.get('q')).toBe('Cobalt')
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.locator('[data-record-link]')).toHaveCount(2)
  await page.getByLabel('Filter by milestone').selectOption('qualified')
  await page.getByLabel('Milestone completion').selectOption('true')
  await expect(page.locator('[data-record-link]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.locator('[data-record-link]')).toHaveCount(2)
  const dana = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Dana Ruiz', exact: true }) })
  await expect(dana.getByRole('link', { name: 'Email', exact: true })).toHaveAttribute('href', 'mailto:dana%40example.com')
  await expect(dana.getByRole('link', { name: 'Call', exact: true })).toHaveAttribute('href', 'tel:+15550102000')
  await expect(dana.getByRole('link', { name: 'Text', exact: true })).toHaveAttribute('href', 'sms:+15550102000')
  assert.equal(people[0].contacted, false)
  await dana.getByRole('button', { name: 'Log contact', exact: true }).click()
  await expect.poll(() => people[0].lastContactedAt).toBeTruthy()
  await expect(page.getByLabel('Contacted for Dana Ruiz')).toBeChecked()
  await dana.getByRole('button', { name: 'Notes', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: /Close/ }).click()
  await page.locator('.contact-column-picker summary').click()
  await page.locator('.contact-column-picker').getByLabel('Potential value').check()
  await page.locator('.contact-column-picker summary').click()
  await page.getByLabel('Potential value for Dana Ruiz').fill('1500.50')
  await page.getByLabel('Potential value for Dana Ruiz').press('Enter')
  await expect.poll(() => people[0].potentialValue).toBe(1500.50)
  await page.reload()
  await expect(page.getByLabel('Potential value for Dana Ruiz')).toHaveValue('1500.5')
  await expect(page.getByLabel('Secondary sort', { exact: true })).toHaveValue('potentialValue')
  failure = { error: 'Save failed. Try again.' }
  await page.getByLabel('Won for Dana Ruiz').click()
  await expect(dana.getByRole('alert')).toContainText('Save failed')
  failure = null
  await dana.getByRole('button', { name: 'Retry save' }).click()
  await expect(page.getByLabel('Won for Dana Ruiz')).toBeChecked()
  await expect(page.getByLabel('Won for Dana Ruiz')).toBeEnabled()
  failure = { error: 'Contact changed; reload', code: 'CONTACT_VERSION_CONFLICT' }
  await page.getByLabel('Proposal sent for Dana Ruiz').click()
  await expect(dana.getByRole('button', { name: 'Reload row' })).toBeVisible()
  failure = null; people[0].version++
  await dana.getByRole('button', { name: 'Reload row' }).click()
  await expect(dana.getByRole('button', { name: 'Reload row' })).toHaveCount(0)
  await expect(page.getByLabel('Proposal sent for Dana Ruiz')).not.toBeChecked()
  await expect(dana.getByRole('alert')).toHaveCount(0)
  await expect(dana.getByRole('button', { name: 'Retry save' })).toHaveCount(0)
  await page.locator('.contact-table-scroll').evaluate(el => { el.scrollLeft = 0 })
  await page.screenshot({ path: '/tmp/contact-workbench-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.contact-table-scroll').evaluate(el => { el.scrollLeft = 0 })
  await expect(page.getByRole('link', { name: 'Dana Ruiz', exact: true })).toBeVisible()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: '/tmp/contact-workbench-mobile.png' })
  assert.deepEqual(errors, [])
  console.log('Contact workbench: inline edits, search, sorting, filters, persistence, outreach, errors, conflicts, and mobile passed.')
} finally {
  await browser.close()
  await rm(output, { recursive: true, force: true })
}
