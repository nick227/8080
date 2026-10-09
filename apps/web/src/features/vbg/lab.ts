import { startCompositor, type StageCapture } from '../virtualCamera'
import { createMediapipeSource } from './mediapipeSource'
import { createModnetSource } from './modnetSource'
import type { MaskSource } from './types'

// Development-only entry; not imported by the app or emitted in its build.
document.body.innerHTML = `<style>
body{font:15px system-ui;background:#151719;color:#eee;margin:24px;max-width:1500px}button,input,select{font:inherit;padding:8px;margin:4px}button{cursor:pointer}video{width:480px;max-width:100%}canvas{max-width:100%}#roi{width:480px;cursor:crosshair;touch-action:none}#views{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0}figcaption{padding:8px 0}pre{white-space:pre-wrap}a{color:#9cceff}label{display:inline-block}small{color:#bbb}
</style><h1>Head retention lab</h1>
<p>Record original camera footage once. Replay the same timestamps through each backend and the actual app compositor. Files stay in this browser unless you download them.</p>
<button id="camera">Start camera</button><button id="record" disabled>Record raw clip</button><button id="stop" disabled>Stop & use clip</button>
<label>Or open a raw recording <input id="file" type="file" accept="video/*"></label><button id="saveRaw" disabled>Download original</button>
<p><label><input id="rawConfirmed" type="checkbox">This clip has no background effects applied</label></p>
<video id="video" controls muted playsinline></video><canvas id="roi"></canvas>
<p>Pause at a frame, then drag a rectangle <strong>inside the visible head</strong> on the right. Add keyframes as the head moves; rectangles interpolate between them. Include first and last test frames. Do not include background. Hair-boundary loss and motion lag still need visual review.</p>
<button id="clearRoi">Clear head annotations</button><span id="roiStatus">No head annotations: acceptance cannot pass.</span>
<p><label>Start (s) <input id="start" type="number" min="0" value="0" step="0.1"></label><label>End (s) <input id="end" type="number" min="0.1" value="10" step="0.1"></label><label>Samples/s <input id="fps" type="number" min="1" max="60" value="30"></label></p>
<button id="run">Compare all three backends</button><button id="cancel" disabled>Cancel</button><button id="report" disabled>Download report + failure snapshots</button><button id="snapshot">Download current five-stage image</button>
<p id="status">Load or record an original clip. The existing composited upload is a failure reference only.</p><div id="views"></div><pre id="summary"></pre>`
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const button = (id: string) => el<HTMLButtonElement>(id)
const video = el<HTMLVideoElement>('video'), roiCanvas = el<HTMLCanvasElement>('roi')
const status = (message: string) => { el('status').textContent = message }
const makeCanvas = (w = 480, h = 270) => Object.assign(document.createElement('canvas'), { width: w, height: h })
const names = ['Original camera', 'Raw model mask', 'Stabilized mask', 'RGB-guided mask', 'Final app composite']
const views = names.map(name => {
  const figure = document.createElement('figure'), caption = document.createElement('figcaption'), canvas = makeCanvas()
  caption.textContent = name; figure.append(caption, canvas); el('views').append(figure); return canvas
})
const sheet = makeCanvas(1440, 620)
const rawCanvas = makeCanvas()
let clip: Blob | null = null, clipName = '', url = '', camera: MediaStream | null = null, recorder: MediaRecorder | null = null
let cancelled = false, running = false
let report: Record<string, unknown> = {}
type Box = { t: number; x: number; y: number; w: number; h: number }
let boxes: Box[] = []
const download = (blob: Blob, name: string) => {
  const href = URL.createObjectURL(blob), a = document.createElement('a'); a.href = href; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(href), 10_000)
}
function useClip(blob: Blob, name: string) {
  if (url) URL.revokeObjectURL(url)
  camera?.getTracks().forEach(track => track.stop()); camera = null
  video.srcObject = null; clip = blob; clipName = name; url = URL.createObjectURL(blob); video.src = url
  boxes = []; button('saveRaw').disabled = false; button('record').disabled = true
  el<HTMLInputElement>('rawConfirmed').checked = false
  status('Clip loaded. Confirm it is original footage and annotate the head before comparing.')
}
button('camera').onclick = async () => {
  try {
    camera?.getTracks().forEach(track => track.stop())
    camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false })
    video.srcObject = camera; await video.play(); button('record').disabled = false
    status('Camera preview is raw; background effects are not applied.')
  } catch (error) { status(String(error)) }
}
button('record').onclick = () => {
  if (!camera) return
  const parts: Blob[] = []
  recorder = new MediaRecorder(camera, { videoBitsPerSecond: 12_000_000 })
  recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data) }
  recorder.onstop = () => { useClip(new Blob(parts, { type: recorder!.mimeType }), 'raw-webcam.webm'); el<HTMLInputElement>('rawConfirmed').checked = true }
  recorder.start(1000); button('stop').disabled = false; button('record').disabled = true; button('camera').disabled = true
  status('Recording raw camera. Reproduce the dark-hair/head disappearance conditions for 10–20 seconds.')
}
button('stop').onclick = () => { recorder?.stop(); button('stop').disabled = true; button('camera').disabled = false }
el<HTMLInputElement>('file').onchange = event => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) useClip(file, file.name) }
button('saveRaw').onclick = () => { if (clip) download(clip, clipName) }
video.onloadedmetadata = () => { if (Number.isFinite(video.duration)) el<HTMLInputElement>('end').value = String(Math.min(20, video.duration)) }
function drawRoi() {
  if (video.readyState < 2 || running) return
  roiCanvas.width = 480; roiCanvas.height = Math.round(480 * video.videoHeight / video.videoWidth)
  const ctx = roiCanvas.getContext('2d')!; ctx.drawImage(video, 0, 0, roiCanvas.width, roiCanvas.height)
  const box = boxAt(video.currentTime)
  if (box) { ctx.strokeStyle = '#00ff99'; ctx.lineWidth = 2; ctx.strokeRect(box.x * roiCanvas.width, box.y * roiCanvas.height, box.w * roiCanvas.width, box.h * roiCanvas.height) }
}
video.ontimeupdate = drawRoi; video.onseeked = drawRoi; video.onloadeddata = drawRoi
function boxAt(t: number): Box | null {
  if (!boxes.length || t < boxes[0]!.t - 0.04 || t > boxes[boxes.length - 1]!.t + 0.04) return null
  const right = boxes.find(b => b.t >= t) ?? boxes[boxes.length - 1]!, left = [...boxes].reverse().find(b => b.t <= t) ?? right
  const f = right.t === left.t ? 0 : (t - left.t) / (right.t - left.t)
  return { t, x: left.x + (right.x - left.x) * f, y: left.y + (right.y - left.y) * f, w: left.w + (right.w - left.w) * f, h: left.h + (right.h - left.h) * f }
}
let anchor: { x: number; y: number } | null = null
const point = (event: PointerEvent) => { const r = roiCanvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)) } }
roiCanvas.onpointerdown = event => { if (running) return; video.pause(); anchor = point(event); roiCanvas.setPointerCapture(event.pointerId) }
roiCanvas.onpointerup = event => {
  if (!anchor) return
  const p = point(event), box = { t: video.currentTime, x: Math.min(anchor.x, p.x), y: Math.min(anchor.y, p.y), w: Math.abs(p.x - anchor.x), h: Math.abs(p.y - anchor.y) }; anchor = null
  if (box.w < 0.01 || box.h < 0.01) return
  boxes = boxes.filter(b => Math.abs(b.t - box.t) > 0.02).concat(box).sort((a, b) => a.t - b.t)
  el('roiStatus').textContent = `${boxes.length} head keyframes: ${boxes.map(b => b.t.toFixed(2)).join(', ')} s`; drawRoi()
}
button('clearRoi').onclick = () => { boxes = []; el('roiStatus').textContent = 'No annotations'; drawRoi() }
function show(frame: StageCapture) {
  rawCanvas.width = frame.raw.width; rawCanvas.height = frame.raw.height
  const ctx = rawCanvas.getContext('2d')!, pixels = ctx.createImageData(rawCanvas.width, rawCanvas.height)
  for (let i = 0; i < frame.raw.data.length; i++) pixels.data[i * 4 + 3] = Math.round(frame.raw.data[i]! * 255)
  ctx.putImageData(pixels, 0, 0)
  const inputs = [frame.original, rawCanvas, frame.stabilized, frame.refined, frame.final]
  inputs.forEach((input, i) => {
    const target = views[i]!, c = target.getContext('2d')!
    target.height = Math.round(target.width * input.height / input.width)
    c.fillStyle = i > 0 && i < 4 ? '#fff' : '#222'; c.fillRect(0, 0, target.width, target.height)
    c.drawImage(input, 0, 0, target.width, target.height)
    // Mask alpha is black over white; invert for conventional white foreground.
    if (i > 0 && i < 4) { c.globalCompositeOperation = 'difference'; c.fillStyle = '#fff'; c.fillRect(0, 0, target.width, target.height); c.globalCompositeOperation = 'source-over' }
  })
  sheet.height = (views[0]!.height + 40) * 2
  const c = sheet.getContext('2d')!; c.fillStyle = '#151719'; c.fillRect(0, 0, sheet.width, sheet.height)
  views.forEach((view, i) => { const x = i % 3 * 480, y = Math.floor(i / 3) * (view.height + 40); c.fillStyle = '#fff'; c.font = '14px monospace'; c.fillText(`${names[i]} · ${frame.frameId} · ${(frame.timestampMs / 1000).toFixed(3)}s`, x + 4, y + 18); c.drawImage(view, x, y + 30) })
  return [rawCanvas, frame.stabilized, frame.refined]
}
const sample = makeCanvas(256, 144)
function metrics(mask: HTMLCanvasElement, box: Box | null, previous?: Uint8ClampedArray) {
  const ctx = sample.getContext('2d', { willReadFrequently: true })!; ctx.clearRect(0, 0, 256, 144); ctx.drawImage(mask, 0, 0, 256, 144)
  const data = ctx.getImageData(0, 0, 256, 144).data
  let head = 0, n = 0, edgeDelta = 0, edges = 0
  for (let y = 0; y < 144; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4 + 3, a = data[i]!
    if (box && x / 256 >= box.x && x / 256 < box.x + box.w && y / 144 >= box.y && y / 144 < box.y + box.h) { head += a >= 128 ? 1 : 0; n++ }
    if (previous && ((a > 0 && a < 255) || (previous[i]! > 0 && previous[i]! < 255))) { edgeDelta += Math.abs(a - previous[i]!); edges++ }
  }
  return { headCoverage: n ? head / n : null, edgeChange: edges ? edgeDelta / edges / 255 : 0, data }
}
async function seek(t: number) {
  if (Math.abs(video.currentTime - t) < 0.0001 && video.readyState >= 2) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Seek timed out at ${t}s`)) }, 10_000)
    const done = () => { cleanup(); resolve() }; const fail = () => { cleanup(); reject(new Error('Video decode failed')) }
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail) }
    video.addEventListener('seeked', done); video.addEventListener('error', fail); video.currentTime = t
  })
}
button('snapshot').onclick = () => sheet.toBlob(blob => { if (blob) download(blob, 'five-stages.png') })
button('report').onclick = () => download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), 'head-retention-report.json')
button('cancel').onclick = () => { cancelled = true }
button('run').onclick = async () => {
  if (!clip || camera || !el<HTMLInputElement>('rawConfirmed').checked) { status('Load original footage and confirm background effects are absent.'); return }
  const start = Number(el<HTMLInputElement>('start').value), end = Number(el<HTMLInputElement>('end').value), fps = Number(el<HTMLInputElement>('fps').value)
  if (!(start >= 0 && end > start && end - start <= 60 && fps >= 1 && fps <= 60)) { status('Use a valid 1–60 second interval and 1–60 samples/s.'); return }
  if (Number.isFinite(video.duration) && end > video.duration) { status(`End must be within the clip (${video.duration.toFixed(2)}s).`); return }
  running = true; cancelled = false; video.pause()
  for (const id of ['run', 'file', 'camera', 'clearRoi']) (el(id) as HTMLButtonElement).disabled = true
  button('cancel').disabled = false
  const results: Record<string, unknown>[] = []
  report = { clipName, size: clip.size, start, end, fps, boxes: structuredClone(boxes), acceptance: 'Zero significant head dropouts: <90% annotated head-core coverage for >=100ms. Manual review of final output, motion lag and hair boundary remains required.', results }
  const frame = makeCanvas(video.videoWidth, video.videoHeight), hashes: string[] = []
  const factories: [string, () => Promise<MaskSource>][] = [['mediapipe', createMediapipeSource], ['modnet', () => createModnetSource()], ['rvm-dev', async () => (await import('./rvmSourceDevOnly')).createRvmSource()]]
  try {
    for (const [name, factory] of factories) {
      if (cancelled) break
      status(`Loading ${name}…`)
      let source: MaskSource | null = null, compositor: ReturnType<typeof startCompositor> | null = null
      const rows: Record<string, unknown>[] = [], evidence: { t: number; png: string }[] = []
      const result: Record<string, unknown> = { backend: name, rows, evidence, status: 'running', motionLag: 'Manual review required; no ground-truth motion track supplied' }; results.push(result)
      let previous: Uint8ClampedArray[] = [], weakRuns = [0, 0, 0], events = [0, 0, 0], missingAnnotations = 0
      try {
        source = await factory()
        compositor = startCompositor(source, new MediaStream(), { mode: 'blur', photoUrl: null, mirror: false, fixedSize: true }, message => { throw new Error(message) }, { onFrame: capture => {
          const t = (capture.timestampMs - 1) / 1000, masks = show(capture), box = boxAt(t)
          if (!box) missingAnnotations++
          const measures = masks.map((mask, i) => { const m = metrics(mask, box, previous[i]); previous[i] = m.data; const weak = m.headCoverage !== null && m.headCoverage < 0.9; weakRuns[i] = weak ? weakRuns[i]! + 1 : 0; if (weakRuns[i] === Math.ceil(fps * 0.1)) events[i] = events[i]! + 1; return { headCoverage: m.headCoverage, edgeChange: m.edgeChange } })
          rows.push({ frameId: capture.frameId, timestampMs: capture.timestampMs, backend: capture.backend, inferenceMs: capture.inferenceMs, refinementApplied: capture.refinementApplied, stages: measures, firstWeakStage: measures.findIndex(m => m.headCoverage !== null && m.headCoverage < 0.9) })
          if (weakRuns.some(n => n === Math.ceil(fps * 0.1)) && evidence.length < 20) evidence.push({ t, png: sheet.toDataURL('image/png') })
        } })
        for (let index = 0; index < Math.ceil((end - start) * fps); index++) {
          if (cancelled) break
          const t = start + index / fps; await seek(t)
          if (Math.abs(video.currentTime - t) > 0.05) throw new Error(`Requested frame ${t}s is outside the decoded clip`)
          frame.getContext('2d')!.drawImage(video, 0, 0)
          const bytes = frame.getContext('2d')!.getImageData(0, 0, frame.width, frame.height).data
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('')
          if (!hashes[index]) hashes[index] = hash
          else if (hashes[index] !== hash) throw new Error(`Input frame mismatch at ${t}s`)
          await compositor.evaluateFrame(frame, t * 1000 + 1)
          status(`${name}: ${t.toFixed(2)}s · head-loss events raw/stable/refined ${events.join('/')}`)
          await new Promise(resolve => setTimeout(resolve, 0))
        }
        Object.assign(result, { status: cancelled ? 'cancelled' : 'complete', significantHeadDropouts: events, missingAnnotations, automatedHeadCorePass: !cancelled && fps >= 30 && missingAnnotations === 0 && rows.length > 0 && events[2] === 0, diagnostics: source.diagnostics?.() })
      } catch (error) { Object.assign(result, { status: 'unavailable-or-failed', error: String(error) }) }
      finally { compositor?.stop(); await source?.dispose?.() }
      el('summary').textContent = JSON.stringify(results.map(({ rows, evidence, ...summary }) => summary), null, 2)
    }
    report.frameHashes = hashes
    report.environment = { userAgent: navigator.userAgent, width: frame.width, height: frame.height, devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency }
    status(cancelled ? 'Cancelled. Partial results available.' : 'Comparison finished. Check unavailable backends and manually review head loss and motion lag before accepting.')
  } catch (error) { status(String(error)) }
  finally {
    running = false; button('cancel').disabled = true; button('report').disabled = false
    for (const id of ['run', 'file', 'camera', 'clearRoi']) (el(id) as HTMLButtonElement).disabled = false
  }
}
window.addEventListener('pagehide', () => { camera?.getTracks().forEach(track => track.stop()); if (url) URL.revokeObjectURL(url) })
