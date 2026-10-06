import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { loadStyles } from './style-utils.mjs'

const output = await mkdtemp(join(tmpdir(), 'record-navigation-'))
const browser = await chromium.launch()
const errors = []
const stamp = '2026-10-01T12:00:00.000Z'
const people = Array.from({ length: 30 }, (_, index) => ({
  id: `c${index + 1}`,
  workspaceId: 'w1',
  version: 1,
  displayName: `Contact ${String(index + 1).padStart(2, '0')}`,
  title: null,
  status: 'active',
  leadStatus: index === 14 ? 'qualified' : 'new',
  leadSource: 'Website',
  nextFollowUp: null,
  primaryEmail: `person${index + 1}@example.com`,
  primaryPhone: null,
  ownerMemberId: null,
  accounts: [],
  tags: [],
  points: [],
  createdAt: stamp,
  updatedAt: stamp,
  lastActivityAt: null,
}))
const items = [
  {
    id: 'i1',
    workspaceId: 'w1',
    name: 'Camera package',
    category: 'Photography',
    price: 1800,
    sku: 'CAM-01',
    quantity: null,
    availability: true,
    status: 'active',
    imageUrl: null,
    description: 'Camera and lens package.',
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  },
  {
    id: 'i2',
    workspaceId: 'w1',
    name: 'Studio light',
    category: 'Lighting',
    price: 240,
    sku: 'LIGHT-02',
    quantity: 0,
    availability: true,
    status: 'active',
    imageUrl: null,
    description: 'Portable studio light.',
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  },
]
let failWrite = false
try {
  execFileSync(
    'pnpm',
    [
      'exec',
      'esbuild',
      'tests/records.fixture.tsx',
      '--bundle',
      '--jsx=automatic',
      `--outfile=${join(output, 'fixture.js')}`,
    ],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe' },
  )
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const css = (await loadStyles()) + (await readFile(join(output, 'fixture.css'), 'utf8'))
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } })
  await context.route('http://records.test/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/api', '')
    if (!url.pathname.startsWith('/api'))
      return route.fulfill({
        contentType: 'text/html',
        body: `<style>${css}body{margin:0}</style><div id="root"></div><script>${script}</script>`,
      })
    const method = route.request().method()
    const json = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    if (path === '/auth/guest') return json({ data: { id: 'u1', displayName: 'Test owner', isGuest: false } })
    if (path === '/workspaces')
      return json({ data: [{ id: 'w1', name: 'Studio', defaultCurrency: 'USD' }] })
    if (path.endsWith('/members'))
      return json({
        data: [
          {
            id: 'm1',
            workspaceId: 'w1',
            user: { id: 'u1', name: 'Test owner', avatarUrl: null, kind: 'human', tag: null },
            email: 'owner@example.com',
            role: 'owner',
            status: 'active',
            title: null,
            timezone: null,
            joinedAt: stamp,
            removedAt: null,
          },
        ],
      })
    if (path.endsWith('/accounts') && method === 'POST') {
      const body = route.request().postDataJSON()
      return json({ data: { id: 'a1', name: body.name, workspaceId: 'w1' }, duplicates: [] })
    }
    if (path.endsWith('/timeline')) return json({ data: [], meta: { nextCursor: null } })
    if (path.endsWith('/interests'))
      return json({ data: [{ id: 'interest1', contactId: 'c8', item: items[0], createdAt: stamp }] })
    const match = path.match(/^\/workspaces\/w1\/(contacts|inventory)(?:\/([^/]+))?$/)
    if (match) {
      const rows = match[1] === 'contacts' ? people : items
      if (method === 'PATCH') {
        if (failWrite)
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Test save failure. Try again.' }),
          })
        const record = rows.find((row) => row.id === match[2])
        const body = route.request().postDataJSON()
        Object.assign(record, body)
        if ('version' in record) record.version = (record.version ?? 1) + 1
        return json({ data: record })
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON()
        if (match[1] === 'inventory' && body.sku && rows.some((row) => row.sku === body.sku))
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Another item already uses that code', code: 'SKU_TAKEN' }),
          })
        const record = {
          ...rows[0],
          ...body,
          id: `new-${rows.length}`,
          version: 1,
          displayName: body.displayName ?? rows[0].displayName,
          name: body.name ?? rows[0].name,
          primaryEmail: body.points?.find((p) => p.kind === 'email')?.value ?? null,
          primaryPhone: body.points?.find((p) => p.kind === 'phone')?.value ?? null,
          accounts: body.accounts?.length ? [{ accountId: 'a1', name: 'Acme', role: null, isPrimary: true }] : [],
          quantity: Object.prototype.hasOwnProperty.call(body, 'quantity') ? body.quantity : rows[0].quantity,
        }
        rows.push(record)
        return match[1] === 'contacts'
          ? json({ data: record, duplicates: [] })
          : json({ data: record })
      }
      if (match[2]) {
        const record = rows.find((row) => row.id === match[2])
        return record
          ? json({ data: record })
          : route.fulfill({
              status: 404,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Not found' }),
            })
      }
      const q = (url.searchParams.get('q') || '').toLowerCase()
      const filtered = rows.filter((row) => {
        const status = url.searchParams.get('status') || 'active'
        if (row.status !== status) return false
        if (url.searchParams.get('leadStatus') && row.leadStatus !== url.searchParams.get('leadStatus'))
          return false
        if (!q) return true
        const name = (row.displayName ?? row.name ?? '').toLowerCase()
        const sku = (row.sku ?? '').toLowerCase()
        return name.includes(q) || sku.startsWith(q)
      })
      const start = Number(url.searchParams.get('cursor') || 0)
      return json({
        data: filtered.slice(start, start + 12),
        meta: { nextCursor: start + 12 < filtered.length ? String(start + 12) : null },
      })
    }
    return json({ data: [] })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://records.test/room/studio?desk=contacts')
  await expect(page.getByRole('link', { name: 'Contact 08', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Filter by lead stage' }).selectOption('qualified')
  await expect(page.getByRole('link', { name: 'Contact 15', exact: true })).toBeVisible()
  await expect(page.locator('[data-record-link]')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Filter by lead stage' }).selectOption('')
  await page.getByRole('searchbox', { name: 'Search contacts' }).fill('Contact')
  await expect(page.locator('[data-record-link]')).toHaveCount(12)
  const eight = page.getByRole('link', { name: 'Contact 08', exact: true })
  await expect(eight).toBeVisible()
  await eight.scrollIntoViewIfNeeded()
  const scroll = await page.locator('.records-scroll').evaluate((el) => el.scrollTop)
  await eight.click()
  await expect(page.getByRole('heading', { name: 'Contact 08', exact: true })).toBeVisible()
  await expect(page.getByText('8 of 12 loaded')).toBeVisible()
  await page.getByRole('button', { name: 'Next →', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Contact 09' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Contact 08', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Interested in' })).toBeVisible()
  const interest = page.locator('.record-related').getByRole('button', { name: /^Camera package/ })
  await expect(interest).toBeVisible()
  await interest.click()
  const preview = page.getByRole('region', { name: 'Camera package preview' })
  await expect(preview.getByRole('heading', { name: 'Camera package' })).toBeVisible()
  await preview.getByRole('button', { name: 'Open full record' }).click()
  await expect(page.getByRole('heading', { name: 'Camera package' })).toBeVisible()
  await expect(page.getByRole('button', { name: '← Contact 08', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '← Contact 08', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Contact 08' })).toBeVisible()
  await page.getByRole('button', { name: /← Search .+Contact.+/ }).click()
  await expect(page.getByRole('searchbox', { name: 'Search contacts' })).toHaveValue('Contact')
  assert.ok(
    Math.abs((await page.locator('.records-scroll').evaluate((el) => el.scrollTop)) - scroll) < 5,
    'Back restores collection scroll',
  )
  await expect(eight).toBeFocused()
  const trigger = page.getByRole('button', { name: 'Preview Contact 08', exact: true })
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.record-preview')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await eight.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('link', { name: 'Contact 09', exact: true })).toBeFocused()
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Inventory', exact: true })
    .click()
  await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByRole('link', { name: 'Studio light', exact: true }).click()
  await expect(page.getByText('Out of stock', { exact: true }).first()).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Contacts', exact: true })
    .click()
  await expect(page.getByRole('searchbox', { name: 'Search contacts' })).toHaveValue('Contact')
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Inventory', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Studio light' })).toBeVisible()
  await page.getByRole('button', { name: '← All inventory' }).click()
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.reload()
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('link', { name: 'Camera package', exact: true }).click()
  await page.getByRole('button', { name: 'Edit item', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Edit inventory item' })
  await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Camera kit')
  failWrite = true
  await form.getByRole('button', { name: 'Save changes' }).click()
  await expect(form.getByRole('alert')).toContainText('Test save failure')
  await expect(form.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Camera kit')
  failWrite = false
  await form.getByRole('checkbox', { name: 'Track stock' }).check()
  await form.getByRole('textbox', { name: 'In stock', exact: true }).fill('0')
  await form.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('heading', { name: 'Camera kit' })).toBeVisible()
  assert.equal(items[0].quantity, 0)
  await page.goto('http://records.test/room/studio?desk=contacts')
  await page.getByRole('link', { name: 'Contact 12', exact: true }).click()
  await page.getByRole('button', { name: 'Load more →' }).click()
  await expect(page.getByRole('heading', { name: 'Contact 13' })).toBeVisible()
  await expect(page.getByText('13 of 24 loaded')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Contact 13' })).toBeVisible()
  await page.getByRole('button', { name: '← All contacts', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Contact 13', exact: true })).toBeFocused()
  await expect(page.locator('[data-record-link]')).toHaveCount(24)

  await page.goto('http://records.test/room/studio?desk=inventory&record=i2')
  await expect(page.getByRole('heading', { name: 'Studio light' })).toBeVisible()
  await expect(page.locator('.record-stepper')).toHaveCount(0)
  await page.getByRole('button', { name: '← All inventory' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Preview Studio light' }).click()
  await expect(page.getByRole('dialog', { name: 'Studio light preview' })).toBeVisible()
  assert.equal(
    await page.locator('.records-scroll').getAttribute('inert'),
    '',
    'Narrow preview makes obscured collection inert',
  )
  await page.locator('.record-preview button').last().focus()
  await page.keyboard.press('Tab')
  assert.ok(
    await page.locator('.record-preview').evaluate((el) => el.contains(document.activeElement)),
    'Mobile focus stays in preview',
  )
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Mobile has no horizontal overflow',
  )
  await page.screenshot({ path: join(output, 'mobile.png') })
  await page.getByRole('button', { name: 'Close preview' }).click()
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'))
  await page.setViewportSize({ width: 1280, height: 760 })
  await page.screenshot({ path: '/tmp/records-browse-light.png' })
  await page.getByRole('link', { name: 'Studio light', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Studio light', exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/records-detail-light.png' })
  await expect(page.getByRole('button', { name: 'Adjust stock', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Adjust stock', exact: true }).click()
  const stock = page.getByRole('dialog', { name: 'Adjust stock' })
  await stock.getByRole('textbox', { name: 'New quantity' }).fill('4')
  await stock.getByRole('button', { name: 'Save quantity' }).click()
  await expect(page.getByText('4 in stock', { exact: true }).first()).toBeVisible()
  assert.equal(items[1].quantity, 4)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Edit inventory item' })
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Unfinished studio edit')
  page.once('dialog', (dialog) => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Edit inventory item' }).getByRole('textbox', { name: 'Name', exact: true }),
  ).toHaveValue('Unfinished studio edit')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.getByRole('button', { name: '← All inventory' }).click()
  await page.getByRole('button', { name: '+ Add item' }).click()
  const createItem = page.getByRole('dialog', { name: 'Add inventory item' })
  await createItem.getByRole('textbox', { name: 'Name', exact: true }).fill('Duplicate cam')
  await createItem.getByRole('textbox', { name: 'SKU', exact: true }).fill('CAM-01')
  await createItem.getByRole('button', { name: 'Create' }).click()
  await expect(createItem.getByRole('alert')).toContainText('That SKU is already used')
  await createItem.getByRole('button', { name: 'Open existing item' }).click()
  await expect(page.getByRole('heading', { name: 'Camera kit' })).toBeVisible()

  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Contacts', exact: true })
    .click()
  await page.getByLabel('Stage for Contact 01').selectOption('qualified')
  await expect(page.getByLabel('Stage for Contact 01')).toHaveValue('qualified')
  assert.equal(people[0].leadStatus, 'qualified')
  await page.getByRole('button', { name: '+ Add contact' }).click()
  const createContact = page.getByRole('dialog', { name: 'Add contact' })
  await createContact.getByRole('textbox', { name: 'Name', exact: true }).fill('Ada Lovelace')
  await createContact.getByRole('textbox', { name: 'Email', exact: true }).fill('ada@example.com')
  await createContact.getByRole('combobox', { name: 'Lead stage' }).selectOption('contacting')
  await createContact.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Lead stage' })).toHaveValue('contacting')

  assert.deepEqual(errors, [], 'No browser runtime errors')
  console.log(
    'Passed: browse/record history, related preview and return, scroll/focus restoration, arrow navigation, area memory, refresh, failed saves, stock zero/adjust, pagination, direct links, mobile layout, light theme, SKU conflict, inline stage, and create contact.',
  )
} finally {
  await browser.close()
  await rm(output, { recursive: true, force: true })
}
