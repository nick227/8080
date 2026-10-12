import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
const output = await mkdtemp(join(tmpdir(), 'team-handoff-'))
const browser = await chromium.launch()
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'tests/team-handoff.fixture.tsx', '--bundle', '--jsx=automatic', `--outfile=${join(output, 'fixture.js')}`], { stdio: 'pipe' })
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const page = await browser.newPage()
  let opens = 0
  let fail = false
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://team.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${script}</script>` })
    if (path.endsWith('/channel')) { opens++; return route.fulfill({ json: { data: { roomId: 'room' } } }) }
    await new Promise(resolve => setTimeout(resolve, 300))
    if (fail && path.endsWith('/participants')) return route.fulfill({ status: 500, json: { error: 'Roster unavailable' } })
    const data = path.endsWith('/company') ? { id: 'workspace', member: true } : path.endsWith('/participants') ? [] : { id: 'room', title: 'Team' }
    return route.fulfill({ json: { data } })
  })
  await page.goto('https://team.test/')
  await expect(page.getByRole('heading')).toHaveText('Team ready')
  assert.equal(opens, 1, 'Strict Mode must not open the channel twice')
  assert.equal(await page.locator('html').getAttribute('data-cold-room'), null)
  await page.goto('https://team.test/')
  await page.getByRole('link', { name: 'Board' }).click()
  await page.waitForTimeout(650)
  await expect(page.getByRole('heading')).toHaveText('Board')
  fail = true
  await page.goto('https://team.test/')
  await expect(page.getByRole('alert')).toContainText('Roster unavailable')
  fail = false
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading')).toHaveText('Team ready')
  assert.equal(await page.locator('html').getAttribute('data-cold-room'), null)
  assert.deepEqual(errors, [])
  console.log('Passed: cold Team route mounts ready, Strict Mode opens once, leaving cancels redirect, failed preparation retries.')
} finally { await browser.close(); await rm(output, { recursive: true, force: true }) }
