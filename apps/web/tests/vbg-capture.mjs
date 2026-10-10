import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
try {
  const page = await browser.newPage({ permissions: ['camera'] })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const fakeFactory = name => `export async function ${name}() { return { backend: 'fixture/${name}', sync: false, inputSize: () => ({ width: 16, height: 12 }), run: async () => ({ data: new Float32Array(192).fill(1), width: 16, height: 12 }), dispose: () => {} } }`
  await page.route(/\/src\/features\/vbg\/mediapipeSource\.ts/, route => route.fulfill({ contentType: 'text/javascript', body: fakeFactory('createMediapipeSource') }))
  await page.route(/\/src\/features\/vbg\/modnetSource\.ts/, route => route.fulfill({ contentType: 'text/javascript', body: `export async function createModnetSource() { throw new Error('fixture unavailable GPU') }` }))
  await page.route(/\/src\/features\/vbg\/rvmSourceDevOnly\.ts/, route => route.fulfill({ contentType: 'text/javascript', body: fakeFactory('createRvmSource') }))
  await page.goto('http://localhost:5173/vbg-lab.html')
  await page.getByRole('heading', { name: 'Head retention lab' }).waitFor()
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await page.waitForFunction(() => !document.getElementById('record').disabled)
  await page.getByRole('button', { name: 'Record raw clip', exact: true }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Stop & use clip', exact: true }).click()
  await page.waitForFunction(() => document.getElementById('video').readyState >= 2 && !document.getElementById('video').srcObject)
  assert.ok(await page.locator('#rawConfirmed').isChecked())
  const results = await page.evaluate(async () => {
    const { startCompositor } = await import('/src/features/virtualCamera.ts')
    const input = Object.assign(document.createElement('canvas'), { width: 64, height: 48 })
    const ctx = input.getContext('2d'); const captures = []
    let raw
    const source = { backend: 'test/async', sync: false, inputSize: () => ({ width: 16, height: 12 }), run: async () => { await new Promise(resolve => setTimeout(resolve, 25)); return { data: raw, width: 16, height: 12 } } }
    const compositor = startCompositor(source, new MediaStream(), { mode: 'blur', photoUrl: null, mirror: false }, () => {}, { onFrame: frame => {
      const pixel = canvas => Array.from(canvas.getContext('2d').getImageData(32, 20, 1, 1).data)
      const alpha = canvas => canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3]
      captures.push({ id: frame.frameId, t: frame.timestampMs, original: pixel(frame.original), final: pixel(frame.final), stable: alpha(frame.stabilized), raw: frame.raw.data[100], refined: frame.refinementApplied })
    } })
    raw = new Float32Array(192).fill(1); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 64, 48)
    const first = compositor.evaluateFrame(input, 1)
    // Mutating the caller's input during inference must not alter the paired snapshot.
    ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 0, 64, 48)
    await first
    raw = new Float32Array(192); await compositor.evaluateFrame(input, 34)
    await compositor.evaluateFrame(input, 1201)
    compositor.stop()
    return captures
  })
  console.log('Results refined flags:', results.map(r => ({ id: r.id, t: r.t, refined: r.refined })))
  assert.deepEqual(results.map(r => r.t), [1, 34, 1201])
  assert.deepEqual(results[0].original, [255, 0, 0, 255])
  assert.deepEqual(results[0].final, [255, 0, 0, 255])
  assert.equal(results[1].raw, 0)
  assert.ok(results[1].stable > 240, 'brief dropout retained')
  assert.equal(results[2].stable, 0, 'decay must follow media time, not fast replay wall time')
  assert.ok(results.every(r => r.refined))
  await page.locator('#end').fill('0.2')
  await page.getByRole('button', { name: 'Compare all three backends' }).click()
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Comparison finished'))
  const summary = JSON.parse(await page.locator('#summary').textContent())
  assert.deepEqual(summary.map(row => row.status), ['complete', 'unavailable-or-failed', 'complete'])
  assert.ok(summary[1].error.includes('fixture unavailable GPU'))
  assert.equal(summary[0].automatedHeadCorePass, false, 'missing annotations must not pass')
  assert.equal(summary[2].automatedHeadCorePass, false)
  const telemetry = await page.evaluate(async () => {
    const pipeline = await import('/src/features/virtualCamera.ts')
    const { requestVbgDiagnostic } = await import('/src/features/vbg/diagnostics.ts')
    const { toChw } = await import('/src/features/vbg/ort.ts')
    const colors = Object.assign(document.createElement('canvas'), { width: 3, height: 1 }), ctx = colors.getContext('2d')
    ;['#ff0000', '#00ff00', '#0000ff'].forEach((color, x) => { ctx.fillStyle = color; ctx.fillRect(x, 0, 1, 1) })
    const normalized = Array.from(toChw(colors, 2 / 255, -1))
    const camera = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false })
    const source = { model: 'fixture-fp32', backend: 'modnet/webgpu', sync: false, inputSize: () => ({ width: 16, height: 12 }), run: async () => {
      await new Promise(resolve => setTimeout(resolve, 70))
      return { data: new Float32Array(192).fill(0.75), width: 16, height: 12 }
    } }
    const compositor = pipeline.startCompositor(source, camera, { mode: 'blur', photoUrl: null, mirror: false, fixedSize: true }, () => {})
    try {
      const blob = await requestVbgDiagnostic(), frame = JSON.parse(await blob.text())
      await new Promise(resolve => setTimeout(resolve, 2200))
      return { normalized, stats: pipeline.vbgStats, capture: { model: frame.model, renderer: frame.renderer,
        timestamp: frame.inputTimestampMs, rawLength: frame.rawAlpha.length, rawFirst: frame.rawAlpha[0],
        stagesPresent: ['original','inferenceInput','rawAlphaImage','stabilizedAlpha','refinedAlpha','final'].every(key=>frame[key].startsWith('data:image/png')) } }
    } finally { compositor.stop(); camera.getTracks().forEach(track => track.stop()) }
  })
  assert.deepEqual(telemetry.normalized, [1,-1,-1,-1,1,-1,-1,-1,1], 'MODNet input must be planar RGB normalized to [-1,1]')
  assert.equal(telemetry.stats.renderer, 'canvas2d', 'inference provider must not determine renderer telemetry')
  assert.equal(telemetry.stats.model, 'fixture-fp32')
  assert.equal(telemetry.stats.outputLocation, 'cpu')
  assert.equal(telemetry.stats.gpuReadbacksPerFrame, null, 'unmeasured readbacks must not be presented as zero')
  assert.ok(telemetry.stats.maskAgeMs >= 60, 'live mask age must include inference latency')
  assert.equal(telemetry.capture.rawLength, 192)
  assert.equal(telemetry.capture.rawFirst, 0.75)
  assert.equal(telemetry.capture.renderer, 'canvas2d')
  assert.equal(telemetry.capture.model, 'fixture-fp32')
  assert.ok(telemetry.capture.stagesPresent)
  assert.deepEqual(errors, [])
  console.log('Capture checks passed: raw recording, paired snapshots, exact timestamps, real compositor, media-time decay')
} finally { await browser.close() }
