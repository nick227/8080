import fs from 'fs'

const code = import { create } from 'zustand'
import { createMediapipeSource } from './mediapipeSource'
import { createModnetSource } from './modnetSource'
import type { MaskSource } from './types'

export type FallbackEvent = { source: string; reason: string }
export const fallbacks: FallbackEvent[] = []

export type UpgradeState = { state: 'idle' | 'loading' | 'ready' | 'failed'; pct: number }
export const useMaskUpgrade = create<UpgradeState>(() => ({ state: 'idle', pct: 0 }))

let current: MaskSource | null = null
let chosen: Promise<MaskSource> | null = null
const listeners = new Set<(source: MaskSource) => void>()

export const currentMaskSource = () => current

export function subscribeMaskSource(listener: (source: MaskSource) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function wanted(): string {
  try { return localStorage.getItem('8080.vbg-source') ?? 'auto' } catch { return 'auto' }
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400)

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
  if (wanted() === 'mediapipe') return
  useMaskUpgrade.setState({ state: 'loading', pct: 0 })
  createModnetSource((pct) => useMaskUpgrade.setState({ pct })).then(
    (modnet) => {
      if (wanted() === 'mediapipe') {
        void modnet.dispose?.()
        return
      }
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


fs.writeFileSync('/home/administrator/web/voice-chat-v1/apps/web/src/features/vbg/maskSource.ts', code)
console.log('Successfully wrote updated maskSource.ts with mediapipe override protection!')
