import assert from 'node:assert/strict'
import { score } from '../apps/server/src/bots/choose'
import type { LineDef } from '../apps/server/src/bots/pack'
import { createStabilizer } from '../apps/web/src/features/vbg/stabilizer'
import { waveformPeaks } from '../apps/web/src/features/edit/fitAudio'

const now = new Date('2026-01-01T00:00:00Z')
const lines = ['a', 'b', 'c'].map(key => ({ key, enabled: true, intents: ['fallback'], weight: 2, cooldownSec: 0, minGapSec: 0 })) as LineDef[]
const history = { recent: [
  { key: 'outside-pool', at: now },
  { key: 'a', at: now },
  { key: 'a', at: new Date(+now - 1000) },
  { key: 'b', at: new Date(+now - 2000) },
  { key: 'c', at: new Date(+now - 3000) },
  { key: 'c', at: new Date(+now - 86_400_000) },
], lastBotPostAt: null }
const result = score(lines, { history, now, fillable: () => true, intentScores: new Map(), fallback: 'fallback' })
assert.deepEqual(result, {
  candidates: [{ id: 'c', score: 1, factors: { weight: 2, intentScore: 1, freshness: 0.5 } }],
  filtered: [{ id: 'a', reason: 'recent' }, { id: 'b', reason: 'recent' }],
})
assert.deepEqual(score(lines, { history, now, fillable: () => true, intentScores: new Map() }).candidates, [])

// Test the matte bytes and temporal metrics without requiring a GPU or real canvas.
const images = new WeakMap<object, Uint8ClampedArray>()
Object.assign(globalThis, { document: { createElement: () => {
  const canvas = { width: 0, height: 0, getContext: () => ({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (image: { data: Uint8ClampedArray }) => images.set(canvas, image.data),
  }) }
  return canvas
} } })
const stabilizer = createStabilizer({ keep: 0 })
stabilizer.update({ width: 2, height: 1, data: new Float32Array([0, 1]) })
assert.deepEqual(Array.from(images.get(stabilizer.alpha)!), [0, 0, 0, 85, 0, 0, 0, 170])
assert.deepEqual(stabilizer.takeStats(), { fg: 50, flicker: 0 })
stabilizer.update({ width: 2, height: 1, data: new Float32Array([1, 0]) })
assert.deepEqual(Array.from(images.get(stabilizer.alpha)!), [0, 0, 0, 170, 0, 0, 0, 85])
const stats = stabilizer.takeStats()
assert.equal(stats.fg, 50)
assert.ok(Math.abs(stats.flicker - 100 / 3) < 1e-10)
stabilizer.update({ width: 1, height: 1, data: new Float32Array([1]) })
assert.deepEqual(stabilizer.takeStats(), { fg: 100, flicker: 0 })
assert.deepEqual(waveformPeaks({ getChannelData: () => new Float32Array([0, 0, -1, 1]) } as AudioBuffer, 2), [0, 1])
console.log('Efficiency regression checks passed: scoring, mask pixels/metrics/resize, waveform normalization')
