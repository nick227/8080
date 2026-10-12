// "Get the 8080 app" on the homepage: links to the installable /native/ app.
// Phones go to the app (which offers install); desktops get a preview and a QR code.
import { useEffect, useState } from 'react'
import { IosSteps, isStandalone, knownInstalled, platform, type Platform } from '../native/install'
import './app-promo.css'

export function AppPromo() {
  // Decided after mount: the homepage also renders where navigator differs (prerender, tests).
  const [device, setDevice] = useState<{ platform: Platform; installed: boolean } | null>(null)
  const [steps, setSteps] = useState(false)
  useEffect(() => setDevice({ platform: platform(), installed: isStandalone() || knownInstalled() }), [])

  const phone = device && device.platform !== 'desktop'
  return (
    <section id="app" className="home-section app-promo" aria-labelledby="heading-app">
      <div className="app-promo-copy">
        <p className="app-promo-eyebrow">Mobile app</p>
        <h2 id="heading-app">Get the 8080 app</h2>
        <p>Mentions, assignments, blocked work and conversation activity from every workspace, on your phone. Tap a notification to jump straight to it.</p>
        <div className="app-promo-actions">
          {device?.installed ? (
            <>
              <a className="app-promo-cta" href="/native/">Open the app</a>
              <span className="app-promo-note">Installed on this device</span>
            </>
          ) : device?.platform === 'android' ? (
            <>
              <a className="app-promo-cta" href="/native/?install=1">Get the app</a>
              <span className="app-promo-note">Installs from Chrome. No app store needed.</span>
            </>
          ) : device?.platform === 'ios' ? (
            <>
              <a className="app-promo-cta" href="/native/?install=1">Open the app</a>
              <button type="button" className="app-promo-link" aria-expanded={steps} onClick={() => setSteps((v) => !v)}>Add to Home Screen</button>
            </>
          ) : (
            <>
              <a className="app-promo-cta" href="/native/">Open in browser</a>
              <span className="app-promo-note">Or scan the code with your phone’s camera.</span>
            </>
          )}
        </div>
        {steps && (
          <div className="app-promo-steps">
            <p>Open the app first, then:</p>
            <IosSteps />
          </div>
        )}
      </div>
      {device && !phone && (
        <div className="app-promo-visual">
          <PhonePreview />
          <figure className="app-promo-qr">
            <QrCode text={`${window.location.origin}/native/`} />
            <figcaption>Scan to open on your phone</figcaption>
          </figure>
        </div>
      )}
    </section>
  )
}

/** A still of the app's inbox (illustrative content, no data). */
function PhonePreview() {
  const rows = [
    { ws: 'Northwind', kind: 'Mentions', title: 'Sam mentioned you on NW-42', unread: true },
    { ws: 'Harbor Studio', kind: 'Assigned', title: 'Ana assigned you HS-17', unread: true },
    { ws: 'Northwind', kind: 'Blocked', title: 'Lee marked NW-39 blocked', unread: false },
  ]
  return (
    <div className="app-promo-phone" aria-hidden>
      <div className="app-promo-screen">
        <div className="app-promo-bar"><b>8080</b><i /></div>
        <div className="app-promo-title">Inbox <span>2 unread</span></div>
        {rows.map((r) => (
          <div key={r.title} className="app-promo-row" data-unread={r.unread || undefined}>
            <span>{r.ws} · {r.kind}</span>
            <strong>{r.title}</strong>
          </div>
        ))}
        <div className="app-promo-tabs"><span>Inbox</span><span>Workspaces</span><span>Settings</span></div>
      </div>
    </div>
  )
}

function QrCode({ text }: { text: string }) {
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
  if (!path) return <span className="app-promo-qr-blank" />
  return (
    <svg viewBox={`0 0 ${path.size} ${path.size}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges">
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  )
}
