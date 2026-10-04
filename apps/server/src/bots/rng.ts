// Reproducible randomness (doc/08 §4.4): seed = hash of what the decision is about,
// so the same inputs always give the same draw.
import { createHash } from 'crypto'

export function seedOf(...parts: (string | number)[]) {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

/** mulberry32 over the seed's first 32 bits → floats in [0, 1). */
export function rngFrom(seed: string) {
  let a = parseInt(seed.slice(0, 8), 16) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
