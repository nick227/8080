import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { loadStyles } from './style-utils.mjs'
const output = await mkdtemp(join(tmpdir(), 'tasks-surface-'))
const browser = await chromium.launch()
const stamp = new Date().toISOString()
const defaults = { workspaceId: 'w1', description: '', scheduledDate: null, scheduledTime: null, dueDate: null, status: 'open', source: null, assigneeMemberId: 'm1', assignee: { name: 'Alex', avatarUrl: null }, priority: 'medium', issueType: 'task', rank: 1024, version: 1, commentCount: 0, createdAt: stamp, updatedAt: stamp }
const tasks = [{ ...defaults, id: 't1', taskKey: 'VC-1', title: 'Review launch plan' }, { ...defaults, id: 't2', taskKey: 'VC-2', title: 'Publish release notes', status: 'done' }]
const comments = []
let failComment = false
const errors = []
try {
  execFileSync('pnpm', ['exec', 'esbuild', 'tests/tasks.fixture.tsx', '--bundle', '--jsx=automatic', `--outfile=${join(output, 'fixture.js')}`], { stdio: 'pipe' })
  const script = await readFile(join(output, 'fixture.js'), 'utf8')
  const css = await loadStyles() + await readFile(join(output, 'fixture.css'), 'utf8')
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://tasks.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    const json = data => route.fulfill({ json: { data } })
    if (!path.startsWith('/api')) return route.fulfill({ contentType: 'text/html', body: `<style>${css}body{margin:0}</style><div id="root"></div><script>${script}</script>` })
    if (path.endsWith('/stream')) return route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' })
    if (path === '/api/auth/me') return json({ id: 'u1', displayName: 'Alex', isGuest: false })
    if (path === '/api/workspaces') return json([{ id: 'w1', name: 'Launch', role: 'owner' }])
    if (path.endsWith('/members')) return json([{ id: 'm1', status: 'active', user: { id: 'u1', name: 'Alex', avatarUrl: null } }])
    if (path.endsWith('/task-statuses')) return json([
      { key: 'open', label: 'To do', category: 'todo', position: 0, archived: false },
      { key: 'in_progress', label: 'In progress', category: 'doing', position: 1, archived: false },
      { key: 'done', label: 'Done', category: 'done', position: 2, archived: false },
    ])
    if (path.endsWith('/comments')) {
      if (method === 'POST') {
        if (failComment) return route.fulfill({ status: 500, json: { error: 'Try again' } })
        const comment = { id: `c${comments.length}`, taskId: 't1', authorName: 'Alex', createdAt: stamp, text: route.request().postDataJSON().text }
        comments.push(comment)
        return json(comment)
      }
      return json(comments)
    }
    if (path.endsWith('/tasks')) {
      if (method === 'POST') {
        const task = { ...defaults, ...route.request().postDataJSON(), id: 't3', taskKey: 'VC-3' }
        tasks.push(task)
        return json(task)
      }
      return json(tasks)
    }
    if (path.match(/\/tasks\/t\d$/) && method === 'PATCH') {
      const task = tasks.find(t => path.endsWith(t.id))
      Object.assign(task, route.request().postDataJSON(), { version: task.version + 1 })
      return json(task)
    }
    if (path.endsWith('/inbox')) return route.fulfill({ json: { data: [], meta: { nextCursor: null } } })
    return json([])
  })
  await page.goto('https://tasks.test/room/launch/tasks')
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Review launch plan' })).toBeVisible()
  await page.getByLabel('Search tasks', { exact: true }).fill('launch')
  await expect(page.getByRole('link', { name: 'Publish release notes' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Review launch plan' }).click()
  await expect(page).toHaveURL(/\/tasks\/VC-1$/)
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Review launch plan')
  await page.getByLabel('Task update').fill('Ready for review')
  failComment = true
  await page.getByRole('button', { name: 'Post update', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText("Couldn't post")
  await expect(page.getByLabel('Task update')).toHaveValue('Ready for review')
  failComment = false
  await page.getByRole('button', { name: 'Post update', exact: true }).click()
  await expect(page.getByText('Ready for review', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Ready for review', { exact: true })).toBeVisible()
  await page.getByLabel('Title', { exact: true }).fill('Review launch plan together')
  await page.getByLabel('Description', { exact: true }).click()
  await expect.poll(() => tasks[0].title).toBe('Review launch plan together')
  await page.getByRole('button', { name: '← All tasks' }).click()
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible()
  await page.getByLabel('Search tasks', { exact: true }).fill('')
  await page.getByLabel('Filter by status').selectOption('done')
  await expect(page.getByRole('link', { name: 'Publish release notes' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Review launch plan together' })).toHaveCount(0)
  await page.getByLabel('Filter by status').selectOption('all')
  await page.getByRole('button', { name: /New task/ }).click()
  await page.getByLabel('Title', { exact: true }).fill('Prepare customer briefing')
  await page.getByLabel('Description (optional)').fill('Summarize the launch changes.')
  await page.getByLabel('Due date (optional)').fill('2026-11-01')
  await page.getByLabel('Priority', { exact: true }).selectOption('high')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByRole('link', { name: 'Prepare customer briefing' })).toBeVisible()
  assert.equal(tasks[2].dueDate, '2026-11-01')
  assert.equal(tasks[2].priority, 'high')
  assert.equal(tasks[2].scheduledDate, null)
  await page.screenshot({ path: '/tmp/tasks-list-desktop.png' })
  await page.getByRole('link', { name: 'Prepare customer briefing' }).click()
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Contacts', exact: true }).click()
  await expect(page).toHaveURL(/\/room\/launch\?desk=contacts$/)
  await expect(page.getByText('Contacts surface')).toBeVisible()
  await page.goto('https://tasks.test/room/launch?desk=calendar&ticket=VC-1')
  await expect(page).toHaveURL(/\/tasks\/VC-1$/)
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Review launch plan together')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Task page fits mobile')
  await page.screenshot({ path: '/tmp/tasks-page-mobile.png' })
  await page.goto('https://tasks.test/room/launch/tasks/VC-999')
  await expect(page.getByRole('heading', { name: 'Task not found' })).toBeVisible()
  assert.deepEqual(errors, [])
  console.log('Tasks passed: list/search/status, dedicated URLs/reload, create fields, edits, updates/retry, navigation, legacy links, missing tasks, mobile overflow.')
} finally { await browser.close(); await rm(output, { recursive: true, force: true }) }
