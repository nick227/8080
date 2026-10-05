import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices
    const original = devices.getUserMedia.bind(devices)
    const streams: MediaStream[] = []
    const calls: MediaStreamConstraints[] = []
    Object.assign(window, { captureStreams: streams, captureCalls: calls })
    devices.getUserMedia = async constraints => {
      calls.push(constraints ?? {})
      // Simulate a device that refuses a second camera open.
      if (constraints?.video && calls.filter(c => c.video).length > 1) throw new DOMException('Camera reopened', 'NotReadableError')
      const stream = await original(constraints)
      streams.push(stream)
      return stream
    }
  })
  await page.route('**/__camera-handoff', route => route.fulfill({ contentType: 'text/html', body: `
    <html><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;
    window.__vite_plugin_react_preamble_installed__=true;
    await import('/tests/fixtures/camera-handoff.tsx');
    </script></body></html>` }))
  await page.goto('/__camera-handoff')
  await expect.poll(() => page.evaluate(() => (window as any).captureStreams.length)).toBe(1)
  await expect.poll(() => page.locator('video').evaluate(video => !!(video as HTMLVideoElement).srcObject)).toBe(true)
})

test('records using the existing preview camera and releases tracks on stop', async ({ page }) => {
  await page.getByText('Start', { exact: true }).click()
  await expect(page.locator('[data-phase]')).toHaveText('recording')
  expect(await page.evaluate(() => (window as any).captureCalls)).toEqual([
    expect.objectContaining({ audio: false, video: expect.any(Object) }), { audio: true, video: false },
  ])
  await page.waitForTimeout(350)
  await page.getByText('Stop', { exact: true }).click()
  await expect(page.locator('[data-phase]')).toHaveText('review')
  expect(await page.evaluate(() => (window as any).captureStreams.every((s: MediaStream) => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true)
})

test('releases acquired tracks when recorder construction fails', async ({ page }) => {
  await page.evaluate(() => { (window as any).MediaRecorder = class { constructor() { throw new DOMException('Encoder failed', 'NotSupportedError') } } })
  await page.getByText('Start', { exact: true }).click()
  await expect(page.locator('[data-phase]')).toHaveText('captureFailed')
  await expect(page.locator('[data-error]')).toHaveText('Could not start recording')
  expect(await page.evaluate(() => (window as any).captureStreams.every((s: MediaStream) => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true)
})

test('cancellation during device acquisition stops a late stream', async ({ page }) => {
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints)
      await new Promise<void>(resolve => { (window as any).releaseMicrophone = resolve })
      return stream
    }
  })
  await page.getByText('Start', { exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!(window as any).releaseMicrophone)).toBe(true)
  await page.getByText('Cancel', { exact: true }).click()
  await page.evaluate(() => (window as any).releaseMicrophone())
  await expect(page.locator('[data-phase]')).toHaveText('idle')
  await expect.poll(() => page.evaluate(() => (window as any).captureStreams.every((s: MediaStream) => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true)
})
