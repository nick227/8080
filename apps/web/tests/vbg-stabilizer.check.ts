import assert from 'node:assert/strict'
import { createStabilizer } from '../src/features/vbg/stabilizer'

let now = 2000
Object.defineProperty(globalThis, 'performance', { value: { now: () => now } })
Object.defineProperty(globalThis, 'document', { value: {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => {},
  }) }),
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
