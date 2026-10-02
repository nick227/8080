let previewCtx: AudioContext | null = null
let previewEl: HTMLAudioElement | null = null
let notifyPreview: ((id: string | null) => void) | null = null
let previewToken = 0
let previewArmed = false

// Resumed in the click that applies a track, so playback can start after the file decodes.
export function primePreviewAudio(): AudioContext {
  if (!previewCtx || previewCtx.state === 'closed') previewCtx = new AudioContext()
  void previewCtx.resume()
  return previewCtx
}

export function stopStockPreview() {
  previewArmed = false
  previewEl?.pause()
  notifyPreview?.(null)
}

export function releaseStockPreview() {
  notifyPreview = null
  previewArmed = false
  previewEl?.pause()
}

export function toggleStockPreview(id: string, url: string, onChange: (playingId: string | null) => void) {
  notifyPreview = onChange
  if (!previewEl) {
    previewEl = new Audio()
    previewEl.onended = () => {
      const duration = previewEl?.duration ?? Number.NaN
      const time = previewEl?.currentTime ?? 0
      const finished = previewEl?.ended && Number.isFinite(duration) && time + 0.25 >= duration
      if (!previewArmed || !finished) return
      previewArmed = false
      notifyPreview?.(null)
    }
  }
  if (previewEl.dataset.track === id && !previewEl.paused) {
    previewArmed = false
    previewEl.pause()
    onChange(null)
    return
  }
  const token = ++previewToken
  previewArmed = false
  previewEl.pause()
  previewEl.dataset.track = id
  previewEl.src = url
  onChange(id)
  void previewEl.play().then(() => {
    if (token === previewToken) previewArmed = true
  }).catch(() => {
    if (token === previewToken) onChange(null)
  })
}
