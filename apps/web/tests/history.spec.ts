import { test, expect } from '@playwright/test'

test('recent window, explicit older pages, stable scroll, live insertion and incremental reconnect', async ({ page }) => {
  const requests: string[] = []
  let releaseOlder: (() => void) | undefined
  const item = (number: number) => ({ id: `item-${number}`, roomId: 'history', number, message: { text: `Message ${number}` }, reactions: [] })
  await page.addInitScript(() => {
    class FakeSource extends EventTarget {
      static latest: FakeSource
      onopen?: () => void
      onerror?: () => void
      constructor() { super(); FakeSource.latest = this }
      close() {}
    }
    Object.assign(window, { EventSource: FakeSource })
  })
  await page.route('**/history-api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participants')) return route.fulfill({ json: { data: [] } })
    requests.push(url.search)
    expect(url.searchParams.get('order')).toBe('desc')
    expect(url.searchParams.get('limit')).toBe('3')
    const older = url.searchParams.has('cursor')
    if (older) await new Promise<void>(resolve => { releaseOlder = resolve })
    await route.fulfill({ json: { data: (older ? [3, 2, 1] : [6, 5, 4]).map(item), meta: { changeCursor: '0', hasMore: !older, nextCursor: older ? null : 'older' } } })
  })
  await page.route('**/__history-test', (route) => route.fulfill({ contentType: 'text/html', body: `
    <html><head><style>
      .room-stream { height: 300px; overflow: auto; overflow-anchor: none; }
      .room-entry { height: 150px; }
    </style></head><body><div id="root"></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/tests/fixtures/history.tsx');
    </script></body></html>` }))
  await page.goto('/__history-test')
  await expect(page.locator('[data-item-id]')).toHaveCount(3)
  await expect(page.locator('[data-item-id]').first()).toHaveAttribute('data-item-id', 'item-4')
  expect(requests).toHaveLength(1)
  await page.evaluate(() => {
    const source = (window.EventSource as any).latest
    source.dispatchEvent(new MessageEvent('item.created', { data: JSON.stringify({ cursor: '1', item: { id: 'item-7', roomId: 'history', number: 7, message: { text: 'Message 7' }, reactions: [] } }) }))
  })
  await expect(page.locator('[data-item-id]')).toHaveCount(4)
  await page.evaluate(() => {
    const source = (window.EventSource as any).latest
    source.dispatchEvent(new MessageEvent('item.updated', { data: JSON.stringify({ cursor: '2', item: { id: 'item-1', roomId: 'history', number: 1, message: { text: 'Message 1' }, reactions: [] } }) }))
  })
  await expect(page.locator('[data-item-id="item-1"]')).toHaveCount(0)
  const load = page.getByRole('button', { name: 'Load older messages' })
  await load.scrollIntoViewIfNeeded()
  const before = await page.locator('[data-item-id="item-4"]').boundingBox()
  await load.click()
  await expect.poll(() => !!releaseOlder).toBe(true)
  await page.evaluate(() => {
    const source = (window.EventSource as any).latest
    source.dispatchEvent(new MessageEvent('item.updated', { data: JSON.stringify({ cursor: '3', item: { id: 'item-4', roomId: 'history', number: 4, message: { text: 'Changed during pagination' }, reactions: [] } }) }))
  })
  releaseOlder!()
  await expect(page.locator('[data-item-id]')).toHaveCount(7)
  const after = await page.locator('[data-item-id="item-4"]').boundingBox()
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2)
  expect(requests).toHaveLength(2)
  await expect(page.locator('[data-item-id="item-4"]')).toContainText('Changed during pagination')
  await expect(load).toHaveCount(0)
  await page.evaluate(() => {
    const source = (window.EventSource as any).latest
    source.onopen()
    source.dispatchEvent(new MessageEvent('item.updated', { data: JSON.stringify({ cursor: '4', item: { id: 'item-1', roomId: 'history', number: 1, message: { text: 'Recovered edit' }, reactions: [] } }) }))
  })
  await expect(page.locator('[data-item-id]')).toHaveCount(7)
  await expect(page.locator('[data-item-id="item-1"]')).toContainText('Recovered edit')
  expect(requests).toHaveLength(2)
  await expect(page.locator('[data-item-id="item-4"]')).toContainText('Changed during pagination')
  await expect(load).toHaveCount(0)
})
