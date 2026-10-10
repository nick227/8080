import assert from 'node:assert/strict'
import { createStabilizer } from '../src/features/vbg/stabilizer'

let now = 2000
Object.defineProperty(globalThis, 'performance', { value: { now: () => now } })
Object.defineProperty(globalThis, 'document', { value: {
  createElement: () => {
    const element = { width: 0, height: 0, pixels: new Uint8ClampedArray(), getContext: () => ({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image: { data: Uint8ClampedArray }) => { element.pixels = image.data },
    }) }
    return element
  },
} })
const w = 32, h = 40
const person = () => {
  const data = new Float32Array(w * h)
  for (let y = 4; y < 36; y++) for (let x = 10; x < 22; x++) data[y * w + x] = 1
  return data
}
function scenario(fps: number) {
  now += 2000 // Don't seed independent scenarios from another camera session.
  const stabilizer = createStabilizer()
  const update = (data: Float32Array) => { now += 1000 / fps; stabilizer.update({ data, width: w, height: h }) }
  update(person())
  const head = 8 * w + 16
  const broken = person()
  for (let y = 4; y < 16; y++) for (let x = 10; x < 22; x++) broken[y * w + x] = 0
  for (let frame = 0; frame < Math.floor(fps * 0.2); frame++) {
    update(broken)
    assert.ok(stabilizer.confidence()![head]! > 0.95, 'brief head loss must stay opaque')
  }
  assert.equal(stabilizer.takeStats().headRetained, 100)
  update(person())
  assert.ok(stabilizer.confidence()![head]! > 0.95, 'recovery must be immediate')
  // Alternating uncertainty must not punch holes in an established head.
  for (let frame = 0; frame < 30; frame++) {
    const uncertain = person(); uncertain[head] = frame % 2 ? 0.4 : 0.6
    update(uncertain)
    assert.ok(stabilizer.confidence()![head]! > 0.95)
  }
  // A person really leaving must eventually clear; persistence is not permanent.
  for (let frame = 0; frame < Math.ceil(fps * 1.2); frame++) update(new Float32Array(w * h))
  assert.ok(stabilizer.confidence()![head]! < 0.01, 'sustained absence must clear')
  update(person())
  assert.ok(stabilizer.confidence()![head]! > 0.95, 'new foreground must acquire immediately')
  assert.ok(stabilizer.usable(now))
  assert.equal(stabilizer.usable(now + 501), false)
}
for (const fps of [10, 15, 30, 60]) scenario(fps)
console.log('VBG stability checks passed at 10, 15, 30 and 60 masks/s')

// A translating head must not retain its old location as a second silhouette.
for (const fps of [15, 30, 60]) {
  const stabilizer = createStabilizer({}, true)
  let t = 1
  stabilizer.update({ data: person(), width: w, height: h }, t)
  const moved = new Float32Array(w * h)
  for (let y = 4; y < 36; y++) for (let x = 14; x < 26; x++) moved[y * w + x] = 1
  stabilizer.update({ data: moved, width: w, height: h }, t += 1000 / fps)
  assert.ok(stabilizer.confidence()![8 * w + 10]! < 0.01, 'old head position must clear on translation')
  assert.ok(stabilizer.confidence()![8 * w + 24]! > 0.99, 'new head position must acquire immediately')
  // Persistent ambiguous background must stop inheriting old opaque alpha.
  const ambiguous = new Float32Array(w * h).fill(0.4)
  for (let frame = 0; frame < fps; frame++) stabilizer.update({ data: ambiguous, width: w, height: h }, t += 1000 / fps)
  assert.ok(stabilizer.confidence()![8 * w + 16]! < 0.1, 'mid-band evidence cannot preserve an opaque ghost indefinitely')
}
console.log('Motion and uncertain-background ghost regression checks passed')

const border = createStabilizer({}, true)
border.update({ data: person(), width: w, height: h }, 1)
const rendered = (border.alpha as unknown as { pixels: Uint8ClampedArray }).pixels
assert.equal(rendered[(8 * w + 9) * 4 + 3], 0, 'no added halo outside the model silhouette')
assert.equal(rendered[(8 * w + 10) * 4 + 3], 255, 'do not erode the foreground boundary')
console.log('Rendered silhouette has no dilation halo or erosion')
