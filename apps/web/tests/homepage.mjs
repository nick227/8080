import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { loadStyles } from './style-utils.mjs'
const output = await mkdtemp(join(tmpdir(), 'homepage-'))
const browser = await chromium.launch()
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'tests/homepage.fixture.tsx', '--bundle', '--jsx=automatic', '--define:__VBG_ASSETS__={"mediapipe":"","ort":"","modnet":""}', '--define:import.meta.env.DEV=false', '--loader:.wasm=file', '--loader:.onnx=file', `--outfile=${join(output, 'fixture.js')}`], { stdio: 'pipe' })
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const css = await loadStyles() + await readFile(join(output, 'fixture.css'), 'utf8')
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  let member = false, failList = false, failCreate = false, creations = 0, delaySession = false
  let workspaces = [{ id: 'company-one', name: 'Test Company', role: 'owner' }]
  await page.route('https://homepage.test/**', async route => {
    const { pathname } = new URL(route.request().url())
    if (pathname.startsWith('/workspace-examples/')) return route.fulfill({ contentType: 'image/jpeg', body: await readFile(`public${pathname}`) })
    if (!pathname.startsWith('/api')) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script>${script}</script>` })
    if (delaySession && pathname === '/api/auth/guest') await new Promise(resolve => setTimeout(resolve, 500))
    if (pathname === '/api/auth/guest' || pathname === '/api/auth/me') return route.fulfill({ json: { data: { id: 'user-one', displayName: 'Test User', isGuest: !member, email: member ? 'test@example.com' : null } } })
    if (pathname === '/api/auth/login' || pathname === '/api/auth/register') { member = true; return route.fulfill({ json: { data: {} } }) }
    if (pathname === '/api/workspaces' && route.request().method() === 'POST') {
      creations++
      expect(route.request().postDataJSON().name).toBe('New Company')
      if (failCreate) return route.fulfill({ status: 500, json: { error: 'Please try again' } })
      workspaces = [{ id: 'new-company', name: 'New Company', role: 'owner' }]
      return route.fulfill({ json: { data: workspaces[0] } })
    }
    if (pathname === '/api/workspaces') return route.fulfill({ status: failList ? 500 : 200, json: failList ? { error: 'Unavailable' } : { data: workspaces } })
    if (pathname.includes('/rooms')) return route.fulfill({ json: { data: [], meta: { nextCursor: null } } })
    return route.fulfill({ json: { data: [] } })
  })
  delaySession = true
  await page.goto('https://homepage.test')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run your company from one workspace.')
  delaySession = false
  // Persistent main app masthead
  await expect(page.locator('.masthead')).toBeVisible()
  await expect(page.locator('.masthead .mast-account')).toBeVisible()
  // No top-level left sidebar
  await expect(page.locator('.bp-navigation')).toHaveCount(0)
  // Combined home page has Workspaces, Community, and Blueprints
  await expect(page.getByRole('heading', { name: 'Community' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Blueprints' })).toBeVisible()
  await expect(page.locator('.bp-catalog-card')).toHaveCount(3)
  await expect(page.locator('.bp-catalog input, .bp-catalog button')).toHaveCount(0)

  // Test persistent masthead across page transitions
  await page.evaluate(() => { document.querySelector('.masthead').dataset.testIdentity = 'persistent' })
  await page.getByRole('link', { name: 'Read Solo Operator', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Solo Operator')
  await expect(page.locator('.masthead')).toHaveAttribute('data-test-identity', 'persistent')
  await expect(page.locator('header.masthead')).toHaveCount(1)

  // Navigate back home via masthead Lobby/Home icon
  await page.locator('.masthead').getByRole('link', { name: 'Home' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run your company from one workspace.')
  await expect(page.locator('.masthead')).toHaveAttribute('data-test-identity', 'persistent')

  // Navigate to create workspace via client-side link
  await page.getByRole('link', { name: 'Create a workspace' }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create a workspace')
  await expect(page.locator('.masthead')).toHaveAttribute('data-test-identity', 'persistent')

  // Navigate back to reader to continue blueprint tests
  await page.locator('.masthead').getByRole('link', { name: 'Home' }).click()
  await page.getByRole('link', { name: 'Read Solo Operator', exact: true }).click()
  await expect(page.locator('.masthead')).toHaveAttribute('data-test-identity', 'persistent')

  await page.locator('.bp-person-strip').getByRole('button', { name: /Alex Morgan/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Qualifies client inquiries')
  await page.getByRole('dialog').getByRole('button', { name: /Standardize master services/ }).click()
  await expect(page.getByRole('dialog')).toContainText('A signed master services agreement template with clear boundaries.')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.bp-scenario-stat')).toHaveText('2 people')
  await page.getByRole('link', { name: 'All tasks', exact: true }).click()
  await expect(page.locator('.bp-task-list .bp-task-button')).toHaveCount(18)
  await page.getByLabel('Filter by person').selectOption('finance')
  await expect(page.locator('.bp-task-list .bp-task-button')).toHaveCount(3)
  await page.getByLabel('Filter by person').selectOption('all')
  await expect(page.locator('.bp-task-list .bp-task-button')).toHaveCount(18)
  await page.getByRole('link', { name: 'A week of work', exact: true }).click()
  await expect(page.locator('.bp-day-task').first()).toContainText('Standardize master services')
  await page.getByRole('button', { name: 'Next week', exact: true }).click()
  await expect(page.getByLabel('Week', { exact: true })).toHaveValue('2')
  await page.getByLabel('Week', { exact: true }).selectOption('4')
  await expect(page.locator('.bp-week-grid')).toContainText('weekly delivery progress check-in')
  await page.getByRole('link', { name: 'Documents', exact: true }).click()
  await page.getByRole('button', { name: /Budget plan/ }).click()
  await expect(page.getByRole('dialog')).toContainText('dual-sided')
  await page.keyboard.press('Escape')
  expect(creations).toBe(0)
  await page.getByRole('link', { name: '← Blueprint catalog', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mkdir('../../artifacts/blueprints', { recursive: true })
  for (const theme of ['dark', 'light', 'retro-terminal', 'ultra-large']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))).toEqual({ width, scroll: width })
      await expect.poll(() => page.locator('.bp-card-photo img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
      await page.screenshot({ path: `../../artifacts/blueprints/catalog-${theme}-${width}.png`, fullPage: true })
      await page.getByRole('link', { name: 'Read Project Studio', exact: true }).click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Project Studio')
      await expect.poll(() => page.locator('.bp-main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.screenshot({ path: `../../artifacts/blueprints/reader-${theme}-${width}.png`, fullPage: true })
      await page.getByRole('link', { name: '← Blueprint catalog', exact: true }).click()
      for (const path of ['workspaces', 'conversations', 'workspaces/new', 'account']) {
        await page.goto(`https://homepage.test/${path}`)
        await expect(page.locator('.masthead')).toHaveCount(1)
        await expect.poll(() => page.locator('.bp-main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await page.screenshot({ path: `../../artifacts/blueprints/shell-${path.replaceAll('/', '-')}-${theme}-${width}.png`, fullPage: true })
      }
      await page.goto('https://homepage.test/blueprints')
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  for (const slug of ['lean-service-team','project-studio']) {
    await page.goto(`https://homepage.test/blueprints/${slug}?section=roadmap`)
    await expect(page.locator('.bp-roadmap > article')).toHaveCount(5)
    await page.getByRole('link', { name: 'People', exact: true }).click()
    await expect(page.locator('.bp-person-card')).toHaveCount(slug === 'project-studio' ? 5 : 4)
  }
  await page.goto('https://homepage.test/?record=1')
  await expect(page.getByRole('dialog', { name: 'New conversation' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Community', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New conversation' })).toHaveCount(0)
  await page.goto('https://homepage.test/workspaces/new')
  await page.getByLabel('Email', { exact: true }).fill('test@example.com')
  await page.getByLabel('Password', { exact: true }).fill('test-password')
  await page.locator('form').getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await expect(page.getByLabel('Company name', { exact: true })).toBeVisible()
  await page.getByLabel('Company name', { exact: true }).fill('New Company')
  failCreate = true
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Please try again')
  await expect(page.getByLabel('Company name', { exact: true })).toHaveValue('New Company')
  failCreate = false
  // Stop at the company destination: domain APIs are outside this fixture.
  await page.route('https://homepage.test/api/workspaces/new-company', route => route.fulfill({ status: 404, json: { error: 'Fixture destination' } }))
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(page).toHaveURL('https://homepage.test/c/new-company')
  expect(creations).toBe(2)
  await page.goto('https://homepage.test')
  await expect(page.locator('.app-page').getByRole('region', { name: 'Your workspaces' }).getByRole('link', { name: /New Company/ })).toHaveAttribute('href', '/c/new-company')
  await page.goto('https://homepage.test/workspaces')
  await expect(page.getByRole('heading', { name: 'Your workspaces', level: 2 })).toBeVisible()
  workspaces = []
  await page.reload()
  await expect(page.locator('.app-page').getByText('You do not belong to a workspace yet.')).toBeVisible()
  failList = true
  await page.reload()
  await expect(page.locator('.app-page').getByRole('alert')).toContainText('Could not load workspaces')
  failList = false
  await page.locator('.app-page').getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('.app-page').getByText('You do not belong to a workspace yet.')).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('8080.create-workspace', '1'))
  await page.goto('https://homepage.test')
  await expect(page).toHaveURL('https://homepage.test/workspaces/new')
  await expect(page.getByLabel('Company name', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('8080.create-workspace'))).toBeNull()
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('Homepage checks passed: persistent masthead and avatar, combined Workspaces/Community/Blueprints home page, no left sidebar, dialogs, auth, retry, four themes at desktop and mobile.')
} finally { await browser.close(); await rm(output, { recursive: true, force: true }) }
