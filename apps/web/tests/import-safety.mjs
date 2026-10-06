import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { loadStyles } from './style-utils.mjs'
const dir = await mkdtemp(join(tmpdir(), 'import-safety-'))
const browser = await chromium.launch()
try {
  execFileSync(
    'pnpm',
    [
      'exec',
      'esbuild',
      'tests/import-safety.fixture.tsx',
      '--bundle',
      '--jsx=automatic',
      `--outfile=${join(dir, 'fixture.js')}`,
    ],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe' },
  )
  const script = await readFile(join(dir, 'fixture.js'), 'utf8')
  const css =
    (await loadStyles()) +
    (await readFile(new URL('../src/features/records/records.css', import.meta.url), 'utf8'))
  const batch = {
    id: 'job1',
    kind: 'contacts',
    status: 'previewed',
    source: { filename: 'contacts.csv' },
    options: {},
    columns: [{ id: 'c1', label: 'Name' }],
    mapping: { c1: 'displayName' },
    totalRows: 2,
    counts: {
      create: 1,
      match: 0,
      review: 1,
      duplicate: 0,
      invalid: 0,
      unresolved: 1,
      created: 0,
      matched: 0,
      skipped: 0,
    },
  }
  const rows = [
    {
      id: 'r1',
      rowNumber: 1,
      proposal: 'review',
      values: { displayName: 'Someone' },
      candidates: [
        { id: 'alice', displayName: 'Alice', primaryEmail: 'shared@example.com' },
        { id: 'bob', displayName: 'Bob', primaryEmail: 'shared@example.com' },
      ],
      resolution: null,
      outcome: null,
    },
    {
      id: 'r2',
      rowNumber: 2,
      proposal: 'create',
      values: { displayName: 'New' },
      candidates: [],
      outcome: null,
    },
  ]
  let commits = 0,
    cancellations = 0,
    chosen = ''
  const context = await browser.newContext()
  await context.route('http://imports.test/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const json = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
    if (!url.pathname.startsWith('/api/'))
      return route.fulfill({
        contentType: 'text/html',
        body: `<style>${css}</style><div id="root"></div><script>${script}</script>`,
      })
    if (method === 'DELETE') {
      cancellations++
      return json({ data: batch })
    }
    if (url.pathname.endsWith('/resolution')) {
      chosen = route.request().postDataJSON().contactId
      rows[0].resolution = 'use'
      batch.counts.unresolved = 0
      return json({ data: batch })
    }
    if (url.pathname.endsWith('/rows')) return json({ data: rows, meta: { nextCursor: null } })
    if (url.pathname.endsWith('/commit')) {
      commits++
      if (commits === 1) {
        batch.status = 'committing'
        batch.counts.created = 1
        rows[1].outcome = 'created'
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Connection interrupted' }),
        })
      }
      batch.status = 'completed'
      batch.counts.matched = 1
      rows[0].outcome = 'matched'
    }
    return json({ data: batch })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('http://imports.test/')
  await page.getByRole('button', { name: 'CSV', exact: true }).click()
  await page.getByLabel('CSV file').setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Name\nSomeone\nNew'),
  })
  await expect(page.getByText('contacts.csv', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Preview rows' }).click()
  await expect(page.getByText('Matched contacts remain unchanged.')).toBeVisible()
  await page.getByRole('button', { name: 'Use Bob · shared@example.com', exact: true }).click()
  assert.equal(chosen, 'bob', 'User chooses a named candidate rather than the first match')
  await page.getByRole('button', { name: 'Import contacts', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Connection interrupted')
  await expect(page.getByText('1 of 2 rows processed.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Retry remaining rows' })).toBeVisible()
  assert.equal(cancellations, 0, 'Reload does not cancel the import')
  await page.getByRole('button', { name: 'Retry remaining rows' }).click()
  await expect(page.getByText('Created 1 · existing records matched 1 · skipped 0')).toBeVisible()
  await expect(page.getByText('Row 1 · matched — unchanged')).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  assert.equal(await page.evaluate(() => sessionStorage.getItem('records.import:workspace:contacts')), null)
  assert.deepEqual(errors, [])
  console.log(
    'Passed: named matching decisions, honest outcomes, interrupted-job recovery, reload/resume, and remaining-row retry.',
  )
} finally {
  await browser.close()
  await rm(dir, { recursive: true, force: true })
}
