import { requestVbgDiagnostic } from '../vbg/diagnostics'
import { useEffect, useState } from 'react'
import { vbgRecording, vbgStats } from '../virtualCamera'

// TEMPORARY developer readout for tuning the virtual background against real webcams.
// Shown in dev builds, or anywhere with localStorage['8080.vbg-debug'] = '1'.
const enabled = () => {
  if (import.meta.env.DEV) return true
  try { return localStorage.getItem('8080.vbg-debug') === '1' } catch { return false }
}

export function VbgReadout() {
  const [, tick] = useState(0)
  const [captureStatus, setCaptureStatus] = useState('')
  const capture = async () => {
    setCaptureStatus('Capturing…')
    try {
      const blob = await requestVbgDiagnostic(), url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = 'vbg-synchronized-frame.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setCaptureStatus('Frame saved')
    } catch (error) { setCaptureStatus(String(error)) }
  }
  useEffect(() => {
    if (!enabled()) return
    const timer = window.setInterval(() => tick((n) => n + 1), 500)
    return () => window.clearInterval(timer)
  }, [])
  const s = vbgStats ?? (typeof window !== 'undefined' ? (window as any).__vbgStats : null)
  if (!enabled() || !s) return null
  return (
    <div className="vbg-readout-wrap">
      <pre className="vbg-readout" aria-hidden>
        {`backend  ${s.backend} (${s.model}) · renderer: ${s.renderer} · output: ${s.outputLocation}${s.failed ? ' · FAILED' : ''}
telemetry readbacks/frame: ${s.gpuReadbacksPerFrame ?? 'unmeasured'} · mask age: ${s.maskAgeMs === null ? 'no mask' : `${s.maskAgeMs}ms`}
camera   ${s.camera} → canvas ${s.canvas}
mask     in ${s.maskInput} → ${s.mask}
infer    ${s.inferMs} ms · ${s.maskFps} masks/s · main ${s.mainSegMs} ms · tier ${s.tier}
refine   ${s.refinement} · ${s.refineMs} ms submission/copy
source   ${s.inferenceDetail}
draw     ${s.drawMs} ms · ${s.fps} fps · polish ${s.polish ? 'on' : 'off'} · blur ${s.blur}
edge     fg ${s.fg}% · flicker ${s.flicker}%
stability area Δ ${s.areaDelta}% · prior-mask held ${s.headRetained}% · weak ${s.headWeakMs} ms
rec      ${vbgRecording ? `${vbgRecording.mime} · ${(vbgRecording.videoBitsPerSecond / 1e6).toFixed(1)} Mbps` : '—'}${s.fallbacks ? `\nfallback ${s.fallbacks}` : ''}`}
      </pre>
      <div className="vbg-diagnostic-controls">
        <button type="button" onClick={capture} disabled={captureStatus === 'Capturing…'}>
          Save synchronized diagnostic frame
        </button>
        <button
          type="button"
          style={{ marginLeft: '8px', opacity: s.model === 'selfie-segmenter' ? 0.6 : 1 }}
          onClick={() => {
            localStorage.setItem('8080.vbg-source', 'mediapipe')
            location.reload()
          }}
        >
          {s.model === 'selfie-segmenter' ? '✓ MediaPipe Selfie Active' : 'Switch to MediaPipe Selfie'}
        </button>
        <button
          type="button"
          style={{ marginLeft: '8px', opacity: s.model === 'selfie-multiclass' ? 0.6 : 1 }}
          onClick={() => {
            localStorage.setItem('8080.vbg-source', 'multiclass')
            location.reload()
          }}
        >
          {s.model === 'selfie-multiclass' ? '✓ MediaPipe Multiclass Active' : 'Switch to MediaPipe Multiclass'}
        </button>
        <button
          type="button"
          style={{ marginLeft: '8px', opacity: s.backend.includes('modnet') ? 0.6 : 1 }}
          onClick={() => {
            localStorage.setItem('8080.vbg-source', 'modnet')
            location.reload()
          }}
        >
          {s.backend.includes('modnet') ? '✓ MODNet Active' : 'Switch to MODNet'}
        </button>
        {import.meta.env.DEV && (
          <button
            type="button"
            style={{ marginLeft: '8px', opacity: s.backend.includes('rvm') ? 0.6 : 1 }}
            onClick={() => {
              localStorage.setItem('8080.vbg-source', 'rvm')
              location.reload()
            }}
          >
            {s.backend.includes('rvm') ? '✓ RVM Active' : 'Switch to RVM (Dev Benchmark)'}
          </button>
        )}
        {captureStatus && <span role="status">{captureStatus}</span>}
      </div>
    </div>
  )
}
