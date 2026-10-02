import { create } from 'zustand'

export type CapturePhase =
  | 'idle'
  | 'arming'
  | 'recording'
  | 'stopping'
  | 'review'
  | 'preparing'
  | 'uploading'
  | 'sent'
  | 'permissionDenied'
  | 'captureFailed'
  | 'uploadFailed'

export type CaptureMode = 'audio' | 'video'

type CaptureState = {
  phase: CapturePhase
  mode: CaptureMode | null

  blob: Blob | null
  previewUrl: string | null
  durationMs: number
  level: number
  waveform: number[] | null

  error: string | null

  resumablePlaybackId: string | null
  resumablePlaybackMode: 'chronological' | 'branch' | null

  arm: (mode: CaptureMode) => void
  begin: () => void
  stop: () => void
  review: (blob: Blob, previewUrl: string, durationMs: number, waveform?: number[]) => void
  prepare: () => void
  upload: () => void
  complete: () => void
  failCapture: (error: string) => void
  failUpload: (error: string) => void
  cancel: () => void
  reset: () => void
  
  // Helpers to snapshot and restore playback context
  snapshotPlayback: (id?: string, mode?: 'chronological' | 'branch') => void
}

export const useCapture = create<CaptureState>((set) => ({
  phase: 'idle',
  mode: null,
  blob: null,
  previewUrl: null,
  durationMs: 0,
  level: 0,
  waveform: null,
  error: null,
  resumablePlaybackId: null,
  resumablePlaybackMode: null,

  arm: (mode) => set({ phase: 'arming', mode, error: null }),
  begin: () => set({ phase: 'recording', error: null }),
  stop: () => set({ phase: 'stopping' }),
  
  review: (blob, previewUrl, durationMs, waveform) => set({ 
    phase: 'review', 
    blob, 
    previewUrl, 
    durationMs,
    waveform: waveform ?? null
  }),
  
  prepare: () => set({ phase: 'preparing' }),
  upload: () => set({ phase: 'uploading' }),
  complete: () => set({ 
    phase: 'sent', 
    blob: null, 
    previewUrl: null, 
    durationMs: 0, 
    waveform: null,
    resumablePlaybackId: null, 
    resumablePlaybackMode: null 
  }),
  
  failCapture: (error) => set({ phase: 'captureFailed', error }),
  
  failUpload: (error) => set({ phase: 'uploadFailed', error }),
  
  cancel: () => set({ 
    phase: 'idle', 
    blob: null, 
    previewUrl: null, 
    durationMs: 0,
    waveform: null,
    error: null,
  }),

  reset: () => set({
    phase: 'idle',
    mode: null,
    blob: null,
    previewUrl: null,
    durationMs: 0,
    level: 0,
    waveform: null,
    error: null,
    resumablePlaybackId: null,
    resumablePlaybackMode: null,
  }),

  snapshotPlayback: (id, mode) => set({
    resumablePlaybackId: id ?? null,
    resumablePlaybackMode: mode ?? null
  })
}))

const SPECTRUM_BARS = 42
const spectrum = new Float32Array(SPECTRUM_BARS).fill(0.08)

// Frequency bars for the live recording meter. Kept off the store so a frame
// of audio does not re-render the rest of the desk.
export function publishSpectrum(data: Uint8Array) {
  const step = data.length / SPECTRUM_BARS
  for (let index = 0; index < SPECTRUM_BARS; index++) {
    const start = Math.floor(index * step)
    const end = Math.max(start + 1, Math.floor((index + 1) * step))
    let sum = 0
    for (let bin = start; bin < end; bin++) sum += data[bin] ?? 0
    spectrum[index] = Math.max(0.08, sum / (end - start) / 255)
  }
}

export function readSpectrum() {
  return spectrum
}
