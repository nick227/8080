import { useEffect, useState } from 'react'
import './app-qr.css'

/** A QR code as SVG; the generator loads only when one is shown. */
export function AppQr({ text }: { text: string }) {
  const [path, setPath] = useState<{ d: string; size: number } | null>(null)
  useEffect(() => {
    let live = true
    void import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M')
      qr.addData(text)
      qr.make()
      const n = qr.getModuleCount()
      let d = ''
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + 2} ${y + 2}h1v1h-1z`
      if (live) setPath({ d, size: n + 4 })
    })
    return () => { live = false }
  }, [text])
  if (!path) return <span className="app-qr app-qr-blank" />
  return (
    <svg className="app-qr" viewBox={`0 0 ${path.size} ${path.size}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges">
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  )
}
