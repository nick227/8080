import { create } from 'zustand'
import { createMediapipeSource } from './mediapipeSource'
import { createModnetSource } from './modnetSource'
import type { MaskSource } from './types'

// Chooses the mask source. Default ('auto'): MediaPipe right away (tiny, ready in about
// a second, so Record is never held up), while MODNet (≈ 53 MB first time: model +
// runtime) loads in the background with progress; once it passes its speed gate it
// becomes the current source. Compositors only switch while framing — a recording
// keeps the source it started with ("never switch mid-recording"). If MODNet can't run
// here (no WebGPU, too slow, download failed), MediaPipe simply stays.
//
// Evaluation override: localStorage['8080.vbg-source'] = 'modnet' | 'mediapipe' loads
// that engine directly (no upgrade), and in dev builds only, 'rvm' (GPL-3.0 benchmark;
// excluded from production at build time).

export type FallbackEvent = { source: string; reason: string }
export const fallbacks: FallbackEvent[] = []

export type UpgradeState = { state: 'idle' | 'loading' | 'ready' | 'failed'; pct: number }
/** MODNet's background load, for the strip's progress note. */
export const useMaskUpgrade = create<UpgradeState>(() => ({ state: 'idle', pct: 0 }))

let current: MaskSource | null = null
let chosen: Promise<MaskSource> | null = null
const listeners = new Set<(source: MaskSource) => void>()

/** The best source available right now (null before the first load). */
export const currentMaskSource = () => current
/** Called when a better source becomes current (the background upgrade). */
export function subscribeMaskSource(listener: (source: MaskSource) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function wanted(): string {
  try { return localStorage.getItem('8080.vbg-source') ?? 'auto' } catch { return 'auto' }
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 80)

async function first(tries: Array<[string, () => Promise<MaskSource>]>) {
  for (const [name, make] of tries) {
    try {
      return await make()
    } catch (error) {
      fallbacks.push({ source: name, reason: reason(error) })
    }
  }
  throw new Error('No mask source available')
}

function upgradeToModnet() {
  useMaskUpgrade.setState({ state: 'loading', pct: 0 })
  createModnetSource((pct) => useMaskUpgrade.setState({ pct })).then(
    (modnet) => {
      current = modnet
      useMaskUpgrade.setState({ state: 'ready', pct: 100 })
      listeners.forEach((listener) => listener(modnet))
    },
    (error: unknown) => {
      fallbacks.push({ source: 'modnet/webgpu', reason: reason(error) })
      useMaskUpgrade.setState({ state: 'failed' })
    },
  )
}

/** Resolves with a usable source as soon as one is ready (see above). */
export function loadMaskSource(): Promise<MaskSource> {
  chosen ??= (async () => {
    const want = wanted()
    let source: MaskSource
    if (import.meta.env.DEV && want === 'rvm') {
      source = await first([['rvm-dev', async () => (await import('./rvmSourceDevOnly')).createRvmSource()], ['mediapipe/cpu', createMediapipeSource]])
    } else if (want === 'modnet') {
      source = await first([['modnet/webgpu', () => createModnetSource()], ['mediapipe/cpu', createMediapipeSource]])
    } else {
      source = await first([['mediapipe/cpu', createMediapipeSource]])
      if (want !== 'mediapipe') upgradeToModnet()
    }
    current = source
    return source
  })().catch((error: unknown) => {
    chosen = null
    throw error
  })
  return chosen
}
