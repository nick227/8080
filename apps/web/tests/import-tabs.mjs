import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { loadStyles } from './style-utils.mjs'

const dir = await mkdtemp(join(tmpdir(), 'import-tabs-'))
const browser = await chromium.launch()

try {
  execFileSync(
    'pnpm',
    [
      'exec',
      'esbuild',
      'tests/import-tabs.fixture.tsx',
      '--bundle',
      '--jsx=automatic',
      `--outfile=${join(dir, 'fixture.js')}`,
    ],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe' }
  )

  const script = await readFile(join(dir, 'fixture.js'), 'utf8')
  const css = await loadStyles()

  const context = await browser.newContext()
  await context.addInitScript(() => {
    if (!window.crypto) {
      // @ts-ignore
      window.crypto = {}
    }
    if (!window.crypto.randomUUID) {
      window.crypto.randomUUID = () => '00000000-0000-4000-8000-000000000000'
    }
  })
  await context.route('http://imports.test/**', async (route) => {
    const url = new URL(route.request().url())
    const json = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })

    if (!url.pathname.startsWith('/api/')) {
      return route.fulfill({
        contentType: 'text/html',
        body: `<style>${css}</style><div id="root"></div><script>${script}</script>`,
      })
    }

    if (url.pathname.includes('/email-connections')) {
      return json({
        data: [
          {
            id: 'c1',
            label: 'Support Desk',
            strategy: 'google',
            status: 'active',
            fromEmail: 'support@example.com',
          },
        ],
      })
    }

    if (url.pathname.includes('/agent-types')) {
      return json({
        data: [
          { key: 'team-daily-brief', name: 'Team Daily Brief', family: 'team', description: 'Daily summary' },
        ],
      })
    }

    return json({ data: [] })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (err) => {
    console.error('PAGE ERROR on', page.url(), err)
    errors.push(err.message)
  })

  const testCases = [
    { modal: 'contacts', endpoint: 'POST /api/workspaces/ws-test-123/records?kind=contacts' },
    { modal: 'inventory', endpoint: 'POST /api/workspaces/ws-test-123/records?kind=inventory' },
    { modal: 'tasks', endpoint: 'POST /api/workspaces/ws-test-123/tasks' },
    { modal: 'documents', endpoint: 'POST /api/workspaces/ws-test-123/documents' },
    { modal: 'team', endpoint: 'POST /api/workspaces/ws-test-123/team' },
    { modal: 'budget', endpoint: 'POST /api/workspaces/ws-test-123/budget/items' },
    { modal: 'agents', endpoint: 'POST /api/workspaces/ws-test-123/agents' },
  ]

  for (const tc of testCases) {
    console.log('Testing modal:', tc.modal)
    await page.goto(`http://imports.test/?modal=${tc.modal}`)

    // Verify CSV Upload is the first tab and active by default
    const tabs = page.locator('.import-modal-tab')
    await expect(tabs.first()).toHaveText('CSV Upload')
    await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true')

    // Verify API Connections tab exists and can be selected
    const apiTab = page.getByRole('button', { name: 'API Connections' })
    await expect(apiTab).toBeVisible()
    await apiTab.click()
    await expect(apiTab).toHaveAttribute('aria-pressed', 'true')

    // Verify Workspace Integrations link banner
    await expect(page.getByText('Workspace Integrations')).toBeVisible()
    await expect(page.getByText('Manage in Workspace Settings →')).toBeVisible()

    // Verify Inbound REST API Endpoint
    await expect(page.getByText(tc.endpoint)).toBeVisible()

    // Verify Copy cURL button exists
    await expect(page.getByRole('button', { name: 'Copy cURL' })).toBeVisible()
  }

  assert.deepEqual(errors, [])
  console.log('Passed: All 7 data table import modals show CSV Upload tab first by default, and have API Connections tab linked to workspace integrations.')
} finally {
  await browser.close()
  await rm(dir, { recursive: true, force: true })
}
