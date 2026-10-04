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
  useEffect(() => {
    if (!enabled()) return
    const timer = window.setInterval(() => tick((n) => n + 1), 500)
    return () => window.clearInterval(timer)
  }, [])
  if (!enabled() || !vbgStats) return null
  const s = vbgStats
  return (
    <pre className="vbg-readout" aria-hidden>
      {`camera   ${s.camera}
canvas   ${s.canvas}
seg      ${s.seg}
seg      ${s.segMs} ms · ${s.segFps}/s · tier ${s.tier}${s.failed ? ' · FAILED' : ''}
draw     ${s.fps} fps · matte ${s.matte}
rec      ${vbgRecording ? `${vbgRecording.mime} · ${(vbgRecording.videoBitsPerSecond / 1e6).toFixed(1)} Mbps` : '—'}`}
    </pre>
  )
}
