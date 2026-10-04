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
      {`backend  ${s.backend}${s.failed ? ' · FAILED' : ''}
camera   ${s.camera} → canvas ${s.canvas}
mask     in ${s.maskInput} → ${s.mask}
infer    ${s.inferMs} ms · ${s.maskFps} masks/s · main ${s.mainSegMs} ms · tier ${s.tier}
draw     ${s.drawMs} ms · ${s.fps} fps · polish ${s.polish ? 'on' : 'off'} · blur ${s.blur}
edge     fg ${s.fg}% · flicker ${s.flicker}%
rec      ${vbgRecording ? `${vbgRecording.mime} · ${(vbgRecording.videoBitsPerSecond / 1e6).toFixed(1)} Mbps` : '—'}${s.fallbacks ? `\nfallback ${s.fallbacks}` : ''}`}
    </pre>
  )
}
